// supabase/functions/organizations/index.ts
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

    // Verify SuperAdmin role
    const { data: staff } = await supabase
      .from("staff_profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!staff || staff.role !== "SuperAdmin") {
      return errorResponse("Only SuperAdmin can manage organizations", 403, corsHeaders);
    }

    const { method } = req;
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const orgId = pathParts[pathParts.length - 1];

    if (method === "GET" && orgId && orgId !== "organizations") {
      return await getOrganization(orgId, supabase, corsHeaders);
    } else if (method === "GET") {
      return await listOrganizations(supabase, corsHeaders);
    } else if (method === "POST") {
      return await createOrganization(req, supabase, corsHeaders);
    } else if (method === "PATCH") {
      return await updateOrganization(orgId, req, supabase, corsHeaders);
    } else if (method === "DELETE") {
      return await deleteOrganization(orgId, supabase, corsHeaders);
    }

    return errorResponse("Method not allowed", 405, corsHeaders);
  } catch (error) {
    console.error(error);
    return errorResponse(error.message, 500, corsHeaders);
  }
});

async function listOrganizations(supabase: any, headers: any) {
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("status", "active")
    .order("name");

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 200, headers);
}

async function getOrganization(orgId: string, supabase: any, headers: any) {
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", orgId)
    .eq("status", "active")
    .single();

  if (error) {
    return errorResponse("Organization not found", 404, headers);
  }

  return successResponse(data, 200, headers);
}

async function createOrganization(req: Request, supabase: any, headers: any) {
  const body = await req.json();
  const { name, type, ntn_number } = body;

  if (!name || !type) {
    return errorResponse("Missing name or type", 400, headers);
  }

  const { data, error } = await supabase
    .from("organizations")
    .insert({
      name,
      type,
      ntn_number,
      status: "active",
    })
    .select()
    .single();

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 201, headers);
}

async function updateOrganization(orgId: string, req: Request, supabase: any, headers: any) {
  const body = await req.json();

  const { data, error } = await supabase
    .from("organizations")
    .update(body)
    .eq("id", orgId)
    .select()
    .single();

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 200, headers);
}

async function deleteOrganization(orgId: string, supabase: any, headers: any) {
  const { error } = await supabase
    .from("organizations")
    .update({ status: "suspended" })
    .eq("id", orgId);

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse({ message: "Organization deleted" }, 200, headers);
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
