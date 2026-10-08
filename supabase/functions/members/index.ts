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

    // Use service role for data access — the id is checked against user.id
    // below before any query runs, so this is always scoped to the caller's
    // own row, not a caller-supplied id. Same pattern as /auth/me and
    // /wallet: the anon client can't see its own row here because RLS's
    // auth.uid() doesn't attach to a server-side anon client, not because
    // the row doesn't exist.
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { method, url: reqUrl } = req;
    const url = new URL(reqUrl);
    const pathParts = url.pathname.split("/");
    const memberId = pathParts[pathParts.length - 1];

    if (method === "GET" && memberId && memberId !== "members") {
      return await getMember(memberId, user, supabaseAdmin, corsHeaders);
    } else if (method === "PATCH" && memberId && memberId !== "members") {
      return await updateMember(memberId, user, req, supabaseAdmin, corsHeaders);
    }

    return errorResponse("Method not allowed", 405, corsHeaders);
  } catch (error) {
    console.error(error);
    return errorResponse(error.message, 500, corsHeaders);
  }
});

async function getMember(memberId: string, user: any, supabase: any, headers: any) {
  // Members can only view their own profile
  if (memberId !== user.id) {
    return errorResponse("Forbidden - can only view your own profile", 403, headers);
  }

  const { data, error } = await supabase
    .from("members")
    .select("*")
    .eq("id", memberId)
    .single();

  if (error) {
    return errorResponse(error.message, 404, headers);
  }

  return successResponse(data, 200, headers);
}

async function updateMember(memberId: string, user: any, req: Request, supabase: any, headers: any) {
  // Members can only update their own profile
  if (memberId !== user.id) {
    return errorResponse("Forbidden - can only update your own profile", 403, headers);
  }

  const body = await req.json();
  const { name, email, preferred_language } = body;

  const updates: any = {};
  if (name) updates.name = name;
  if (email) updates.email = email;
  if (preferred_language) updates.preferred_language = preferred_language;

  if (Object.keys(updates).length === 0) {
    return errorResponse("No fields to update", 400, headers);
  }

  const { data, error } = await supabase
    .from("members")
    .update(updates)
    .eq("id", memberId)
    .select()
    .single();

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 200, headers);
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
