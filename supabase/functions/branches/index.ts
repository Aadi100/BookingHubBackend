// supabase/functions/branches/index.ts
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

    const { method } = req;
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const branchId = pathParts[pathParts.length - 1];

    // GET requests are public (no auth required)
    if (method === "GET") {
      if (branchId && branchId !== "branches") {
        return await getBranch(branchId, supabase, corsHeaders);
      } else {
        return await listBranches(url, supabase, corsHeaders);
      }
    }

    // POST, PATCH, DELETE require auth
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return errorResponse("Unauthorized", 401, corsHeaders);
    }

    if (method === "POST") {
      return await createBranch(req, supabase, user, corsHeaders);
    } else if (method === "PATCH") {
      return await updateBranch(branchId, req, supabase, user, corsHeaders);
    } else if (method === "DELETE") {
      return await deleteBranch(branchId, supabase, user, corsHeaders);
    }

    return errorResponse("Method not allowed", 405, corsHeaders);
  } catch (error) {
    console.error(error);
    return errorResponse(error.message, 500, corsHeaders);
  }
});

async function listBranches(url: URL, supabase: any, headers: any) {
  const organizationId = url.searchParams.get("organizationId");

  let query = supabase.from("branches").select("*").eq("status", "active");

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  const { data, error } = await query.order("name");

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 200, headers);
}

async function getBranch(branchId: string, supabase: any, headers: any) {
  const { data, error } = await supabase
    .from("branches")
    .select("*")
    .eq("id", branchId)
    .eq("status", "active")
    .single();

  if (error) {
    return errorResponse("Branch not found", 404, headers);
  }

  return successResponse(data, 200, headers);
}

async function createBranch(req: Request, supabase: any, user: any, headers: any) {
  const body = await req.json();
  const {
    organization_id,
    name,
    venue_type,
    location,
    description,
    amenities,
    tax_enabled,
    tax_rate_percent,
    fbr_pos_registration_number,
  } = body;

  if (!organization_id || !name || !venue_type) {
    return errorResponse("Missing required fields", 400, headers);
  }

  if (!["Court", "Zone"].includes(venue_type)) {
    return errorResponse("Invalid venue_type. Must be 'Court' or 'Zone'", 400, headers);
  }

  // Verify user is OrgAdmin or SuperAdmin for this org
  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("role, organization_id")
    .eq("id", user.id)
    .single();

  if (!staff || (staff.role !== "SuperAdmin" && (staff.role !== "OrgAdmin" || staff.organization_id !== organization_id))) {
    return errorResponse("Unauthorized", 403, headers);
  }

  const { data, error } = await supabase
    .from("branches")
    .insert({
      organization_id,
      name,
      venue_type,
      location,
      description,
      amenities: amenities || [],
      tax_enabled: tax_enabled || false,
      tax_rate_percent: tax_rate_percent || 0,
      fbr_pos_registration_number,
      status: "active",
    })
    .select()
    .single();

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 201, headers);
}

async function updateBranch(branchId: string, req: Request, supabase: any, user: any, headers: any) {
  const body = await req.json();

  const { data: branch } = await supabase
    .from("branches")
    .select("organization_id")
    .eq("id", branchId)
    .single();

  if (!branch) {
    return errorResponse("Branch not found", 404, headers);
  }

  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("role, organization_id, branch_id")
    .eq("id", user.id)
    .single();

  if (!staff || (staff.role === "BranchManager" && staff.branch_id !== branchId)) {
    if (staff.role !== "SuperAdmin" && (staff.role !== "OrgAdmin" || staff.organization_id !== branch.organization_id)) {
      return errorResponse("Unauthorized", 403, headers);
    }
  }

  const { data, error } = await supabase
    .from("branches")
    .update(body)
    .eq("id", branchId)
    .select()
    .single();

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 200, headers);
}

async function deleteBranch(branchId: string, supabase: any, user: any, headers: any) {
  const { data: branch } = await supabase
    .from("branches")
    .select("organization_id")
    .eq("id", branchId)
    .single();

  if (!branch) {
    return errorResponse("Branch not found", 404, headers);
  }

  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("role, organization_id")
    .eq("id", user.id)
    .single();

  if (!staff || (staff.role !== "SuperAdmin" && (staff.role !== "OrgAdmin" || staff.organization_id !== branch.organization_id))) {
    return errorResponse("Unauthorized", 403, headers);
  }

  const { error } = await supabase
    .from("branches")
    .update({ status: "suspended" })
    .eq("id", branchId);

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse({ message: "Branch deleted" }, 200, headers);
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
