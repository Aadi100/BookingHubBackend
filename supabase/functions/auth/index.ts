// supabase/functions/auth/index.ts
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
    const { method, url } = req;
    const urlPath = new URL(url).pathname;

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    if (method === "POST" && urlPath.includes("members/register")) {
      return await registerMember(req, supabase, corsHeaders);
    } else if (method === "POST" && urlPath.includes("members/login")) {
      return await loginMember(req, supabase, corsHeaders);
    } else if (method === "POST" && urlPath.includes("staff/create")) {
      return await createStaff(req, supabase, corsHeaders);
    } else if (method === "POST" && urlPath.includes("staff/login")) {
      return await loginStaff(req, supabase, corsHeaders);
    } else if (method === "GET" && urlPath.includes("me")) {
      return await getMe(req, supabase, corsHeaders);
    }

    return errorResponse("Not found", 404, corsHeaders);
  } catch (error) {
    console.error(error);
    return errorResponse(error.message, 500, corsHeaders);
  }
});

async function registerMember(req: Request, supabase: any, headers: any) {
  const body = await req.json();
  const { name, email, password } = body;

  if (!name || !email || !password) {
    return errorResponse("Missing name, email, or password", 400, headers);
  }

  try {
    // 1. Sign up (creates auth.users)
    const { data: { user: authUser }, error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name }
      }
    });

    if (signupError) {
      return errorResponse(signupError.message, 400, headers);
    }

    // 2. Create member profile
    const { error: memberError } = await supabase
      .from("members")
      .insert({
        id: authUser.id,
        name,
        email,
        status: "active",
        preferred_language: "en"
      });

    if (memberError) {
      return errorResponse(memberError.message, 400, headers);
    }

    // 3. Create wallet
    const { error: walletError } = await supabase
      .from("wallets")
      .insert({
        member_id: authUser.id,
        balance: 0,
        currency: "PKR"
      });

    if (walletError) {
      return errorResponse(walletError.message, 400, headers);
    }

    return successResponse({
      user: authUser,
      message: "Member registered successfully"
    }, 201, headers);
  } catch (error) {
    return errorResponse(error.message, 500, headers);
  }
}

async function createStaff(req: Request, supabase: any, headers: any) {
  // Authenticate requesting user
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return errorResponse("Unauthorized", 401, headers);
  }

  // Check authorization (SuperAdmin or OrgAdmin)
  const { data: staffProfile } = await supabase
    .from("staff_profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!staffProfile || !["SuperAdmin", "OrgAdmin"].includes(staffProfile.role)) {
    return errorResponse("Only SuperAdmin or OrgAdmin can create staff", 403, headers);
  }

  const body = await req.json();
  const { name, email, password, role, organization_id, branch_id } = body;

  if (!name || !email || !password || !role) {
    return errorResponse("Missing required fields", 400, headers);
  }

  try {
    // Use service role key to create auth user
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: { user: authUser }, error: signupError } = await adminClient.auth.admin.createUser({
      email,
      password,
      user_metadata: { full_name: name }
    });

    if (signupError) {
      return errorResponse(signupError.message, 400, headers);
    }

    // Create staff profile
    const { error: profileError } = await supabase
      .from("staff_profiles")
      .insert({
        id: authUser.id,
        name,
        email,
        role,
        organization_id,
        branch_id,
        is_active: true
      });

    if (profileError) {
      return errorResponse(profileError.message, 400, headers);
    }

    return successResponse({
      staff: { id: authUser.id, name, email, role },
      message: "Staff account created successfully"
    }, 201, headers);
  } catch (error) {
    return errorResponse(error.message, 500, headers);
  }
}

async function loginMember(req: Request, supabase: any, headers: any) {
  const body = await req.json();
  const { email, password } = body;

  if (!email || !password) {
    return errorResponse("Missing email or password", 400, headers);
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return errorResponse(error.message, 401, headers);
    }

    return successResponse({
      user: data.user,
      session: data.session,
      message: "Login successful"
    }, 200, headers);
  } catch (error) {
    return errorResponse(error.message, 500, headers);
  }
}

async function loginStaff(req: Request, supabase: any, headers: any) {
  const body = await req.json();
  const { email, password } = body;

  if (!email || !password) {
    return errorResponse("Missing email or password", 400, headers);
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return errorResponse(error.message, 401, headers);
    }

    // Verify user is staff
    const { data: staffProfile } = await supabase
      .from("staff_profiles")
      .select("*")
      .eq("id", data.user.id)
      .single();

    if (!staffProfile) {
      return errorResponse("User is not a staff member", 403, headers);
    }

    return successResponse({
      user: data.user,
      session: data.session,
      staff: staffProfile,
      message: "Staff login successful"
    }, 200, headers);
  } catch (error) {
    return errorResponse(error.message, 500, headers);
  }
}

async function getMe(req: Request, supabase: any, headers: any) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return errorResponse("Unauthorized", 401, headers);
  }

  // Try to get member profile
  const { data: member } = await supabase
    .from("members")
    .select("*")
    .eq("id", user.id)
    .single();

  if (member) {
    return successResponse({
      user,
      profile: member,
      type: "member"
    }, 200, headers);
  }

  // Try to get staff profile
  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (staff) {
    return successResponse({
      user,
      profile: staff,
      type: "staff"
    }, 200, headers);
  }

  return successResponse({
    user,
    profile: null,
    type: "unknown"
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
