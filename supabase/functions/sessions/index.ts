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
      return await listSessions(supabase, user, corsHeaders);
    } else if (method === "DELETE") {
      return await deleteSession(req, supabase, user, corsHeaders);
    }

    return errorResponse("Method not allowed", 405, corsHeaders);
  } catch (error) {
    console.error(error);
    return errorResponse(error.message, 500, corsHeaders);
  }
});

async function listSessions(supabase: any, user: any, headers: any) {
  // List all active sessions for current user (Supabase tracks sessions)
  const { data: { sessions }, error } = await supabase.auth.listSessions();

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  const userSessions = sessions
    ? sessions.map((session: any) => ({
        id: session.id,
        user_id: session.user.id,
        access_token: session.access_token ? session.access_token.substring(0, 20) + "..." : null,
        refresh_token: session.refresh_token ? "***" : null,
        expires_at: session.expires_at,
        created_at: session.created_at,
        updated_at: session.updated_at,
      }))
    : [];

  return successResponse({
    sessions: userSessions,
    total: userSessions.length,
  }, 200, headers);
}

async function deleteSession(req: Request, supabase: any, user: any, headers: any) {
  const body = await req.json();
  const { session_id } = body;

  if (!session_id) {
    return errorResponse("Missing session_id", 400, headers);
  }

  // Sign out from specific session
  const { error } = await supabase.auth.signOut();

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse({
    message: "Session terminated",
    session_id,
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
