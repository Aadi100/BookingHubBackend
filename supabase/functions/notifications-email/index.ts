// supabase/functions/notifications-email/index.ts
// Sends email notifications via Resend
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

    // Route: /functions/v1/notifications-email/send (POST)
    if (req.method === "POST" && pathParts.includes("send")) {
      return await sendEmail(req, corsHeaders);
    }
    // Route: /functions/v1/notifications-email/webhook (POST)
    else if (req.method === "POST" && pathParts.includes("webhook")) {
      return await handleResendWebhook(req, corsHeaders);
    }

    return errorResponse("Not found", 404, corsHeaders);
  } catch (error) {
    console.error(error);
    return errorResponse(error.message, 500, corsHeaders);
  }
});

async function sendEmail(req: Request, headers: any) {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  );

  const body = await req.json();
  const { notification_id, to_email, subject, html_body, template_type } = body;

  if (!notification_id || !to_email || !subject || !html_body) {
    return errorResponse("Missing required fields", 400, headers);
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const resendFromAddress = Deno.env.get("RESEND_FROM_ADDRESS") || "noreply@bookinghub.com";

    if (!resendApiKey) {
      return errorResponse("Resend not configured", 500, headers);
    }

    // Send email via Resend
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: resendFromAddress,
        to: to_email,
        subject: subject,
        html: html_body,
      }),
    });

    if (!emailResponse.ok) {
      const error = await emailResponse.text();
      console.error(`Resend error: ${error}`);
      return errorResponse(`Email send failed: ${error}`, 500, headers);
    }

    const resendResult = await emailResponse.json();

    // Update notification record
    await supabase
      .from("notifications")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        provider_message_id: resendResult.id,
      })
      .eq("id", notification_id);

    return successResponse({
      email_id: resendResult.id,
      status: "sent",
    }, 200, headers);
  } catch (error) {
    // Update notification status to failed
    await supabase
      .from("notifications")
      .update({
        status: "failed",
      })
      .eq("id", notification_id);

    return errorResponse(error.message, 500, headers);
  }
}

async function handleResendWebhook(req: Request, headers: any) {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  );

  try {
    const body = await req.json();
    const event = body;

    switch (event.type) {
      case "email.sent": {
        await supabase
          .from("notifications")
          .update({
            status: "delivered",
            sent_at: new Date().toISOString(),
          })
          .eq("provider_message_id", event.data.id);

        return successResponse({ received: true }, 200, headers);
      }

      case "email.bounced": {
        const { reason } = event.data;

        // Update notification as failed
        const { data: notification } = await supabase
          .from("notifications")
          .select("member_id")
          .eq("provider_message_id", event.data.id)
          .single();

        if (notification?.member_id) {
          // Disable email for this member
          await supabase
            .from("members")
            .update({ email_opt_in: false })
            .eq("id", notification.member_id);

          // Log the bounce
          await supabase
            .from("notifications")
            .update({
              status: "failed",
            })
            .eq("provider_message_id", event.data.id);
        }

        return successResponse({ received: true }, 200, headers);
      }

      case "email.complained": {
        // Similar to bounce - disable email
        const { data: notification } = await supabase
          .from("notifications")
          .select("member_id")
          .eq("provider_message_id", event.data.id)
          .single();

        if (notification?.member_id) {
          await supabase
            .from("members")
            .update({ email_opt_in: false })
            .eq("id", notification.member_id);
        }

        return successResponse({ received: true }, 200, headers);
      }

      default:
        console.log(`Unhandled Resend event: ${event.type}`);
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
