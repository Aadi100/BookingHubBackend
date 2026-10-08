// supabase/functions/refunds/index.ts
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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return errorResponse("Unauthorized", 401, corsHeaders);
    }

    const { method } = req;

    if (method === "GET") {
      return await listRefunds(supabase, user, corsHeaders);
    } else if (method === "POST") {
      return await processRefund(req, supabase, user, corsHeaders);
    }

    return errorResponse("Method not allowed", 405, corsHeaders);
  } catch (error) {
    console.error(error);
    return errorResponse(error.message, 500, corsHeaders);
  }
});

async function listRefunds(supabase: any, user: any, headers: any) {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("status", "refunded")
    .order("created_at", { ascending: false });

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 200, headers);
}

async function processRefund(req: Request, supabase: any, user: any, headers: any) {
  const body = await req.json();
  const { payment_id, reason, amount } = body;

  if (!payment_id) {
    return errorResponse("Missing payment_id", 400, headers);
  }

  // Get payment details
  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .select("*")
    .eq("id", payment_id)
    .single();

  if (paymentError || !payment) {
    return errorResponse("Payment not found", 404, headers);
  }

  if (payment.status === "refunded") {
    return errorResponse("Payment already refunded", 409, headers);
  }

  // Process refund
  const refundAmount = amount || payment.amount;

  // Update payment status
  const { error: updateError } = await supabase
    .from("payments")
    .update({
      status: "refunded",
      refund_amount: refundAmount,
      refund_reason: reason,
      refund_date: new Date().toISOString()
    })
    .eq("id", payment_id);

  if (updateError) {
    return errorResponse(updateError.message, 400, headers);
  }

  // If payment was from booking, add credit to wallet
  if (payment.booking_id) {
    const { data: booking } = await supabase
      .from("bookings")
      .select("member_id")
      .eq("id", payment.booking_id)
      .single();

    if (booking) {
      await supabase
        .from("wallet_credits")
        .insert({
          member_id: booking.member_id,
          reason: "Refund",
          amount: refundAmount,
          reference: `Refund for payment ${payment_id}: ${reason}`
        });
    }
  }

  return successResponse({
    payment_id,
    status: "refunded",
    amount: refundAmount,
    reason,
    processed_at: new Date().toISOString()
  }, 201, headers);
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
