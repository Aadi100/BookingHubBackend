// supabase/functions/courts/index.ts
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
    const pathParts = url.pathname.split("/");
    const courtId = pathParts[pathParts.length - 1];

    if (method === "GET" && courtId && courtId !== "courts") {
      return await getCourt(courtId, supabase, corsHeaders);
    } else if (method === "GET") {
      return await listCourts(url, supabase, corsHeaders);
    } else if (method === "POST") {
      return await createCourt(req, supabase, user, corsHeaders);
    } else if (method === "PATCH") {
      return await updateCourt(courtId, req, supabase, user, corsHeaders);
    } else if (method === "DELETE") {
      return await deleteCourt(courtId, supabase, user, corsHeaders);
    }

    return errorResponse("Method not allowed", 405, corsHeaders);
  } catch (error) {
    console.error(error);
    return errorResponse(error.message, 500, corsHeaders);
  }
});

async function listCourts(url: URL, supabase: any, headers: any) {
  const branchId = url.searchParams.get("branchId");

  if (!branchId) {
    return errorResponse("Missing branchId", 400, headers);
  }

  const { data, error } = await supabase
    .from("courts")
    .select("*")
    .eq("branch_id", branchId)
    .eq("status", "active")
    .order("name");

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 200, headers);
}

async function getCourt(courtId: string, supabase: any, headers: any) {
  const { data, error } = await supabase
    .from("courts")
    .select("*")
    .eq("id", courtId)
    .eq("status", "active")
    .single();

  if (error) {
    return errorResponse("Court not found", 404, headers);
  }

  return successResponse(data, 200, headers);
}

async function createCourt(req: Request, supabase: any, user: any, headers: any) {
  const body = await req.json();

  const { branch_id, name, sport_type, capacity, hourly_rate, amenities } = body;

  if (!branch_id || !name || !sport_type || !hourly_rate) {
    return errorResponse("Missing required fields", 400, headers);
  }

  // Verify user can create courts in this branch
  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("role, branch_id, organization_id")
    .eq("id", user.id)
    .single();

  if (!staff || !["SuperAdmin", "OrgAdmin", "BranchManager"].includes(staff.role)) {
    return errorResponse("Unauthorized", 403, headers);
  }

  if (staff.role === "BranchManager" && staff.branch_id !== branch_id) {
    return errorResponse("Can only create courts in your branch", 403, headers);
  }

  const { data, error } = await supabase
    .from("courts")
    .insert({
      branch_id,
      name,
      sport_type,
      capacity: capacity || 1,
      hourly_rate,
      amenities: amenities || []
    })
    .select()
    .single();

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 201, headers);
}

async function updateCourt(courtId: string, req: Request, supabase: any, user: any, headers: any) {
  const body = await req.json();

  // Verify user can update this court
  const { data: court } = await supabase
    .from("courts")
    .select("branch_id")
    .eq("id", courtId)
    .single();

  if (!court) {
    return errorResponse("Court not found", 404, headers);
  }

  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("role, branch_id")
    .eq("id", user.id)
    .single();

  if (!staff || !["SuperAdmin", "OrgAdmin", "BranchManager"].includes(staff.role)) {
    return errorResponse("Unauthorized", 403, headers);
  }

  if (staff.role === "BranchManager" && staff.branch_id !== court.branch_id) {
    return errorResponse("Can only update courts in your branch", 403, headers);
  }

  const { data, error } = await supabase
    .from("courts")
    .update(body)
    .eq("id", courtId)
    .select()
    .single();

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 200, headers);
}

async function deleteCourt(courtId: string, supabase: any, user: any, headers: any) {
  // Soft delete: set status to suspended
  const { data: court } = await supabase
    .from("courts")
    .select("branch_id")
    .eq("id", courtId)
    .single();

  if (!court) {
    return errorResponse("Court not found", 404, headers);
  }

  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("role, branch_id")
    .eq("id", user.id)
    .single();

  if (!staff || !["SuperAdmin", "OrgAdmin", "BranchManager"].includes(staff.role)) {
    return errorResponse("Unauthorized", 403, headers);
  }

  if (staff.role === "BranchManager" && staff.branch_id !== court.branch_id) {
    return errorResponse("Can only delete courts in your branch", 403, headers);
  }

  const { error } = await supabase
    .from("courts")
    .update({ status: "suspended" })
    .eq("id", courtId);

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse({ message: "Court deleted" }, 200, headers);
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
