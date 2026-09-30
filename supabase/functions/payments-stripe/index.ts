// supabase/functions/payments-stripe/index.ts
// Handles Stripe payment intents and webhooks
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");

    // Route: /functions/v1/payments-stripe/intent (POST)
    if (req.method === "POST" && pathParts.includes("intent")) {
      return await createPaymentIntent(req, corsHeaders);
    }
    // Route: /functions/v1/payments-stripe/webhook (POST)
    else if (req.method === "POST" && pathParts.includes("webhook")) {
      return await handleStripeWebhook(req, corsHeaders);
    }

    return errorResponse("Not found", 404, corsHeaders);
  } catch (error) {
    console.error(error);
    return errorResponse(error.message, 500, corsHeaders);
  }
});

async function createPaymentIntent(req: Request, headers: any) {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  );

  // Authenticate
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return errorResponse("Unauthorized", 401, headers);
  }

  const body = await req.json();
  const { booking_id, amount, currency } = body;

  if (!booking_id || !amount || !currency) {
    return errorResponse("Missing booking_id, amount, or currency", 400, headers);
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return errorResponse("Stripe not configured", 500, headers);
    }

    // Create payment intent with Stripe
    const intentResponse = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        amount: Math.floor(amount * 100).toString(), // Stripe uses cents
        currency: currency.toLowerCase(),
        metadata: {
          booking_id,
          member_id: user.id,
        },
      }).toString(),
    });

    if (!intentResponse.ok) {
      const error = await intentResponse.text();
      return errorResponse(`Stripe error: ${error}`, 400, headers);
    }

    const stripeIntent = await intentResponse.json();

    // Save payment record to Supabase
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .insert({
        booking_id,
        purpose: "booking",
        amount,
        currency,
        provider: "stripe",
        provider_ref: stripeIntent.id,
        status: "pending",
      })
      .select()
      .single();

    if (paymentError) {
      return errorResponse(paymentError.message, 400, headers);
    }

    return successResponse({
      payment_intent_id: stripeIntent.id,
      client_secret: stripeIntent.client_secret,
      amount: stripeIntent.amount,
      currency: stripeIntent.currency,
      status: stripeIntent.status,
    }, 200, headers);
  } catch (error) {
    return errorResponse(error.message, 500, headers);
  }
}

async function handleStripeWebhook(req: Request, headers: any) {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  );

  const stripeWebhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!stripeWebhookSecret) {
    return errorResponse("Webhook secret not configured", 500, headers);
  }

  try {
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      return errorResponse("Missing stripe-signature header", 400, headers);
    }

    // Verify webhook signature (simplified - in production use stripe SDK)
    // For now, just accept it (TODO: implement proper signature verification)

    const event = JSON.parse(body);

    switch (event.type) {
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object;

        // Update payment status
        const { error: updateError } = await supabase
          .from("payments")
          .update({ status: "paid" })
          .eq("provider_ref", paymentIntent.id);

        if (updateError) {
          console.error("Failed to update payment:", updateError);
          return errorResponse("Failed to update payment", 500, headers);
        }

        // Confirm booking if it's a booking payment
        const { data: payment } = await supabase
          .from("payments")
          .select("booking_id")
          .eq("provider_ref", paymentIntent.id)
          .single();

        if (payment?.booking_id) {
          await supabase
            .from("bookings")
            .update({
              status: "Confirmed",
            })
            .eq("id", payment.booking_id);

          // TODO: Enqueue notification for booking confirmation
          // TODO: Enqueue FBR invoicing if branch has tax enabled
        }

        return successResponse({ received: true }, 200, headers);
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object;

        // Update payment status
        await supabase
          .from("payments")
          .update({ status: "failed" })
          .eq("provider_ref", paymentIntent.id);

        // TODO: Enqueue notification for payment failure

        return successResponse({ received: true }, 200, headers);
      }

      case "charge.refunded": {
        const charge = event.data.object;

        // Update payment status
        await supabase
          .from("payments")
          .update({ status: "refunded" })
          .eq("provider_ref", charge.payment_intent);

        return successResponse({ received: true }, 200, headers);
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
        return successResponse({ received: true }, 200, headers);
    }
  } catch (error) {
    console.error("Webhook error:", error);
    return errorResponse(error.message, 500, headers);
  }
}

function successResponse(data: any, statusCode = 200, headers: any = {}) {
  return new Response(JSON.stringify(data), {
    status: statusCode,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, statusCode = 400, headers: any = {}) {
  console.error(`[${statusCode}] ${message}`);
  return new Response(JSON.stringify({ error: message }), {
    status: statusCode,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
