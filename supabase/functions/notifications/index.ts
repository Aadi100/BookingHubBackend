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

    const { method, url: reqUrl } = req;
    const url = new URL(reqUrl);
    const pathParts = url.pathname.split("/");
    const notificationId = pathParts[pathParts.length - 1];

    if (method === "GET" && (pathParts.includes("me") || notificationId === "me")) {
      return await getMyNotifications(user, url, supabase, corsHeaders);
    } else if (method === "PATCH" && notificationId && notificationId !== "me") {
      return await markNotificationAsRead(notificationId, user, req, supabase, corsHeaders);
    } else if (method === "DELETE" && notificationId && notificationId !== "me") {
      return await deleteNotification(notificationId, user, supabase, corsHeaders);
    }

    return errorResponse("Method not allowed", 405, corsHeaders);
  } catch (error) {
    console.error(error);
    return errorResponse(error.message, 500, corsHeaders);
  }
});

async function getMyNotifications(user: any, url: URL, supabase: any, headers: any) {
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const unreadOnly = url.searchParams.get("unread_only") === "true";

  let query = supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (unreadOnly) {
    query = query.eq("is_read", false);
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse({
    notifications: data,
    count,
    limit,
    offset,
  }, 200, headers);
}

async function markNotificationAsRead(notificationId: string, user: any, req: Request, supabase: any, headers: any) {
  // Check if notification belongs to user
  const { data: notification, error: getError } = await supabase
    .from("notifications")
    .select("id")
    .eq("id", notificationId)
    .eq("user_id", user.id)
    .single();

  if (getError || !notification) {
    return errorResponse("Notification not found or access denied", 404, headers);
  }

  const body = await req.json().catch(() => ({}));
  const { is_read } = body;

  const { data, error } = await supabase
    .from("notifications")
    .update({ is_read: is_read !== undefined ? is_read : true })
    .eq("id", notificationId)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 200, headers);
}

async function deleteNotification(notificationId: string, user: any, supabase: any, headers: any) {
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("id", notificationId)
    .eq("user_id", user.id);

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse({
    message: "Notification deleted",
    id: notificationId,
  }, 200, headers);
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
