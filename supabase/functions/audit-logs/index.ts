// supabase/functions/audit-logs/index.ts
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
    const url = new URL(req.url);

    if (method === "GET") {
      return await getAuditLogs(url, supabase, user, corsHeaders);
    } else if (method === "POST") {
      return await logAction(req, supabase, user, corsHeaders);
    }

    return errorResponse("Method not allowed", 405, corsHeaders);
  } catch (error) {
    console.error(error);
    return errorResponse(error.message, 500, corsHeaders);
  }
});

async function getAuditLogs(url: URL, supabase: any, user: any, headers: any) {
  const limit = parseInt(url.searchParams.get("limit") || "100");
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const entity_type = url.searchParams.get("entity_type");

  let query = supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false });

  if (entity_type) {
    query = query.eq("entity_type", entity_type);
  }

  const { data, error, count } = await query
    .range(offset, offset + limit - 1);

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse({
    data,
    count,
    limit,
    offset
  }, 200, headers);
}

async function logAction(req: Request, supabase: any, user: any, headers: any) {
  const body = await req.json();
  const { action, entity_type, entity_id, changes, description } = body;

  if (!action || !entity_type) {
    return errorResponse("Missing action or entity_type", 400, headers);
  }

  // Verify user is admin
  const { data: staffProfile } = await supabase
    .from("staff_profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!staffProfile || !["SuperAdmin", "OrgAdmin", "BranchManager"].includes(staffProfile.role)) {
    return errorResponse("Only admins can log actions", 403, headers);
  }

  const logEntry = {
    action,
    entity_type,
    entity_id,
    user_id: user.id,
    changes,
    description,
    ip_address: req.headers.get("x-forwarded-for") || "unknown",
    user_agent: req.headers.get("user-agent") || "unknown",
    created_at: new Date().toISOString()
  };

  return successResponse(logEntry, 201, headers);
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
