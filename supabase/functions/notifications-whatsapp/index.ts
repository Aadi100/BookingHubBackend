// supabase/functions/notifications-whatsapp/index.ts
// Sends WhatsApp notifications via Meta Cloud API
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

    // Route: /functions/v1/notifications-whatsapp/send (POST)
    if (req.method === "POST" && pathParts.includes("send")) {
      return await sendWhatsApp(req, corsHeaders);
    }
    // Route: /functions/v1/notifications-whatsapp/webhook (POST)
    else if (req.method === "POST" && pathParts.includes("webhook")) {
      return await handleWhatsAppWebhook(req, corsHeaders);
    }

    return errorResponse("Not found", 404, corsHeaders);
  } catch (error) {
    console.error(error);
    return errorResponse(error.message, 500, corsHeaders);
  }
});

async function sendWhatsApp(req: Request, headers: any) {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  );

  const body = await req.json();
  const { notification_id, to_phone, template_name, template_language, template_params } = body;

  if (!notification_id || !to_phone || !template_name) {
    return errorResponse("Missing required fields", 400, headers);
  }

  try {
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const apiVersion = Deno.env.get("WHATSAPP_API_VERSION") || "v21.0";

    if (!phoneNumberId || !accessToken) {
      return errorResponse("WhatsApp not configured", 500, headers);
    }

    // Ensure phone is in E.164 format
    let formattedPhone = to_phone;
    if (!formattedPhone.startsWith("+")) {
      if (!formattedPhone.startsWith("92")) {
        // Assume Pakistan number if not already prefixed
        formattedPhone = "92" + formattedPhone.replace(/^0/, "");
      }
      formattedPhone = "+" + formattedPhone;
    }

    // Build WhatsApp message payload
    const messagePayload: any = {
      messaging_product: "whatsapp",
      to: formattedPhone,
      type: "template",
      template: {
        name: template_name,
        language: {
          code: template_language || "en",
        },
      },
    };

    // Add template parameters if provided
    if (template_params && template_params.length > 0) {
      messagePayload.template.components = [
        {
          type: "body",
          parameters: template_params.map((param) => ({
            type: "text",
            text: param,
          })),
        },
      ];
    }

    // Send via Meta Cloud API
    const response = await fetch(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messagePayload),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error(`WhatsApp error: ${error}`);
      return errorResponse(`WhatsApp send failed: ${error}`, 500, headers);
    }

    const result = await response.json();

    // Update notification record
    await supabase
      .from("notifications")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        provider_message_id: result.messages?.[0]?.id || result.id,
      })
      .eq("id", notification_id);

    return successResponse({
      message_id: result.messages?.[0]?.id,
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

async function handleWhatsAppWebhook(req: Request, headers: any) {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  );

  try {
    const body = await req.json();

    // Meta sends events in a webhook format
    if (body.object === "whatsapp_business_account") {
      const entries = body.entry || [];

      for (const entry of entries) {
        const changes = entry.changes || [];

        for (const change of changes) {
          const value = change.value || {};
          const statuses = value.statuses || [];
          const messages = value.messages || [];

          // Handle message delivery status
          for (const status of statuses) {
            const { id, status: messageStatus, timestamp } = status;

            if (messageStatus === "delivered") {
              await supabase
                .from("notifications")
                .update({
                  status: "delivered",
                })
                .eq("provider_message_id", id);
            } else if (messageStatus === "read") {
              await supabase
                .from("notifications")
                .update({
                  status: "delivered",
                })
                .eq("provider_message_id", id);
            } else if (messageStatus === "failed") {
              await supabase
                .from("notifications")
                .update({
                  status: "failed",
                })
                .eq("provider_message_id", id);
            }
          }

          // Handle inbound messages (optional: for two-way messaging)
          for (const message of messages) {
            const { from, text, type, timestamp } = message;

            // You can implement inbound message handling here
            // For now, we'll just log it
            console.log(`Inbound WhatsApp from ${from}: ${text}`);
          }
        }
      }

      return successResponse({ received: true }, 200, headers);
    }

    return successResponse({ received: true }, 200, headers);
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
