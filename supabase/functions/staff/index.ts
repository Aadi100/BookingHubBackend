// supabase/functions/staff/index.ts
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
    const staffId = pathParts[pathParts.length - 1];

    if (method === "GET" && staffId && staffId !== "staff") {
      return await getStaff(staffId, supabase, user, corsHeaders);
    } else if (method === "GET") {
      return await listStaff(url, supabase, user, corsHeaders);
    } else if (method === "POST") {
      return await createStaff(req, supabase, user, corsHeaders);
    } else if (method === "PATCH") {
      return await updateStaff(staffId, req, supabase, user, corsHeaders);
    } else if (method === "DELETE") {
      return await deleteStaff(staffId, supabase, user, corsHeaders);
    }

    return errorResponse("Method not allowed", 405, corsHeaders);
  } catch (error) {
    console.error(error);
    return errorResponse(error.message, 500, corsHeaders);
  }
});

async function listStaff(url: URL, supabase: any, user: any, headers: any) {
  const organizationId = url.searchParams.get("organizationId");
  const branchId = url.searchParams.get("branchId");

  // Use service role for staff verification (bypass RLS)
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // Verify user has access
  const { data: userStaff, error: userStaffError } = await supabaseAdmin
    .from("staff_profiles")
    .select("role, organization_id, branch_id")
    .eq("id", user.id)
    .single();

  if (!userStaff || userStaffError) {
    return errorResponse("User is not staff", 403, headers);
  }

  let query = supabaseAdmin
    .from("staff_profiles")
    .select("*")
    .eq("is_active", true);

  // SuperAdmin can see all
  if (userStaff.role !== "SuperAdmin") {
    // OrgAdmin can see their org
    if (userStaff.role === "OrgAdmin") {
      if (!organizationId || organizationId !== userStaff.organization_id) {
        return errorResponse("Unauthorized", 403, headers);
      }
      query = query.eq("organization_id", organizationId);
    } else {
      // Other roles can only see their branch
      if (!branchId || branchId !== userStaff.branch_id) {
        return errorResponse("Unauthorized", 403, headers);
      }
      query = query.eq("branch_id", branchId);
    }
  } else if (organizationId) {
    query = query.eq("organization_id", organizationId);
  } else if (branchId) {
    query = query.eq("branch_id", branchId);
  }

  const { data, error } = await query.order("name");

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 200, headers);
}

async function getStaff(staffId: string, supabase: any, user: any, headers: any) {
  const { data, error } = await supabase
    .from("staff_profiles")
    .select("*")
    .eq("id", staffId)
    .eq("is_active", true)
    .single();

  if (error) {
    return errorResponse("Staff not found", 404, headers);
  }

  // Verify access
  const { data: userStaff } = await supabase
    .from("staff_profiles")
    .select("role, organization_id, branch_id")
    .eq("id", user.id)
    .single();

  if (userStaff.role !== "SuperAdmin") {
    if (userStaff.role === "OrgAdmin" && userStaff.organization_id !== data.organization_id) {
      return errorResponse("Unauthorized", 403, headers);
    }
    if (userStaff.role === "BranchManager" && userStaff.branch_id !== data.branch_id) {
      return errorResponse("Unauthorized", 403, headers);
    }
  }

  return successResponse(data, 200, headers);
}

async function createStaff(req: Request, supabase: any, user: any, headers: any) {
  const body = await req.json();
  const { email, password, name, role, organization_id, branch_id } = body;

  if (!email || !password || !name || !role) {
    return errorResponse("Missing required fields", 400, headers);
  }

  if (!["SuperAdmin", "OrgAdmin", "BranchManager", "Staff", "Support"].includes(role)) {
    return errorResponse("Invalid role", 400, headers);
  }

  // Verify user can create staff
  const { data: userStaff } = await supabase
    .from("staff_profiles")
    .select("role, organization_id")
    .eq("id", user.id)
    .single();

  if (!userStaff || !["SuperAdmin", "OrgAdmin"].includes(userStaff.role)) {
    return errorResponse("Unauthorized", 403, headers);
  }

  if (userStaff.role === "OrgAdmin" && userStaff.organization_id !== organization_id) {
    return errorResponse("Can only create staff in your org", 403, headers);
  }

  try {
    // Use service role to create auth user
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: { user: newUser }, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      user_metadata: { full_name: name },
    });

    if (authError) {
      return errorResponse(authError.message, 400, headers);
    }

    // Create staff profile using anon key
    const { data, error: profileError } = await supabase
      .from("staff_profiles")
      .insert({
        id: newUser.id,
        email,
        name,
        role,
        organization_id,
        branch_id,
        is_active: true,
      })
      .select()
      .single();

    if (profileError) {
      return errorResponse(profileError.message, 400, headers);
    }

    return successResponse(data, 201, headers);
  } catch (error) {
    return errorResponse(error.message, 500, headers);
  }
}

async function updateStaff(staffId: string, req: Request, supabase: any, user: any, headers: any) {
  const body = await req.json();

  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("organization_id, branch_id")
    .eq("id", staffId)
    .single();

  if (!staff) {
    return errorResponse("Staff not found", 404, headers);
  }

  const { data: userStaff } = await supabase
    .from("staff_profiles")
    .select("role, organization_id")
    .eq("id", user.id)
    .single();

  if (userStaff.role !== "SuperAdmin" && (userStaff.role !== "OrgAdmin" || userStaff.organization_id !== staff.organization_id)) {
    return errorResponse("Unauthorized", 403, headers);
  }

  const { data, error } = await supabase
    .from("staff_profiles")
    .update(body)
    .eq("id", staffId)
    .select()
    .single();

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 200, headers);
}

async function deleteStaff(staffId: string, supabase: any, user: any, headers: any) {
  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("organization_id")
    .eq("id", staffId)
    .single();

  if (!staff) {
    return errorResponse("Staff not found", 404, headers);
  }

  const { data: userStaff } = await supabase
    .from("staff_profiles")
    .select("role, organization_id")
    .eq("id", user.id)
    .single();

  if (userStaff.role !== "SuperAdmin" && (userStaff.role !== "OrgAdmin" || userStaff.organization_id !== staff.organization_id)) {
    return errorResponse("Unauthorized", 403, headers);
  }

  const { error } = await supabase
    .from("staff_profiles")
    .update({ is_active: false })
    .eq("id", staffId);

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse({ message: "Staff deleted" }, 200, headers);
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
