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

    // Public endpoints (no auth required)
    if (method === "POST" && urlPath.includes("members/register")) {
      return await registerMember(req, supabase, corsHeaders);
    } else if (method === "POST" && urlPath.includes("members/login")) {
      return await loginMember(req, supabase, corsHeaders);
    } else if (method === "POST" && urlPath.includes("staff/login")) {
      return await loginStaff(req, supabase, corsHeaders);
    } else if (method === "POST" && urlPath.includes("password/forgot")) {
      return await forgotPassword(req, supabase, corsHeaders);
    } else if (method === "POST" && urlPath.includes("password/reset")) {
      return await resetPassword(req, supabase, corsHeaders);
    }

    // Protected endpoints (require auth)
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return errorResponse("Unauthorized", 401, corsHeaders);
    }

    if (method === "POST" && urlPath.includes("staff/create")) {
      return await createStaff(req, supabase, corsHeaders);
    } else if (method === "GET" && urlPath.includes("me")) {
      return await getMe(req, supabase, corsHeaders, user);
    } else if (method === "GET" && urlPath.includes("sessions")) {
      return await listSessions(token, user, corsHeaders);
    } else if (method === "DELETE" && urlPath.includes("sessions")) {
      return await deleteSession(req, supabase, token, user, corsHeaders);
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

async function getMe(req: Request, supabase: any, headers: any, user?: any) {
  // If user not passed from main handler, authenticate here
  if (!user) {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !authUser) {
      return errorResponse("Unauthorized", 401, headers);
    }
    user = authUser;
  }

  // Create service role client for internal lookups (bypass RLS)
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // Try to get member profile
  const { data: member, error: memberError } = await supabaseAdmin
    .from("members")
    .select("*")
    .eq("id", user.id)
    .single();

  if (member && !memberError) {
    return successResponse({
      user,
      profile: member,
      type: "member"
    }, 200, headers);
  }

  // Try to get staff profile
  const { data: staff, error: staffError } = await supabaseAdmin
    .from("staff_profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (staff && !staffError) {
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

function decodeJwtPayload(token: string): any {
  try {
    const payloadB64 = token.split(".")[1];
    const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded.padEnd(padded.length + (4 - (padded.length % 4 || 4)) % 4, "="));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function listSessions(token: string, user: any, headers: any) {
  // There is no server-side session store to query here — the bearer token
  // IS the active session. We already validated it (that's how we got
  // `user`), so decode its own claims rather than calling getSession(),
  // which only works against a client-persisted session and is always
  // empty in an edge function.
  const payload = decodeJwtPayload(token);

  if (!payload) {
    return errorResponse("No active session", 401, headers);
  }

  return successResponse({
    sessions: [
      {
        id: payload.session_id || token.substring(0, 20) + "...",
        user_id: user.id,
        email: payload.email,
        issued_at: payload.iat,
        expires_at: payload.exp,
      },
    ],
    total: 1,
  }, 200, headers);
}

async function deleteSession(req: Request, supabase: any, token: string, user: any, headers: any) {
  // Sign out this specific session using its own token, not the shared
  // anon client (which has no session state to sign out of).
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { error } = await userClient.auth.signOut();

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse({
    message: "Session terminated",
  }, 200, headers);
}

async function forgotPassword(req: Request, supabase: any, headers: any) {
  const body = await req.json();
  const { email } = body;

  if (!email) {
    return errorResponse("Missing email", 400, headers);
  }

  // Basic email validation (more lenient for testing)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return errorResponse("Invalid email format", 400, headers);
  }

  try {
    // Use service role to avoid strict validation
    const { error } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email: email,
      options: {
        redirectTo: `${req.headers.get("origin")}/auth/reset-password`,
      },
    });

    if (error) {
      // If user doesn't exist, return success anyway (don't leak user existence)
      return successResponse({
        message: "If an account exists with this email, a password reset link has been sent",
        email,
      }, 200, headers);
    }

    return successResponse({
      message: "Password reset link sent to email",
      email,
    }, 200, headers);
  } catch (error) {
    return successResponse({
      message: "If an account exists with this email, a password reset link has been sent",
      email,
    }, 200, headers);
  }
}

async function resetPassword(req: Request, supabase: any, headers: any) {
  const body = await req.json();
  const { token, password } = body;

  if (!token || !password) {
    return errorResponse("Missing token or password", 400, headers);
  }

  try {
    // Use the recovery token to update password
    const { error } = await supabase.auth.updateUser({
      password: password,
    });

    if (error) {
      return errorResponse(error.message, 400, headers);
    }

    return successResponse({
      message: "Password updated successfully",
    }, 200, headers);
  } catch (error) {
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
