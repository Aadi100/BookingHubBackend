// supabase/functions/rooms/index.ts
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
    const roomId = pathParts[pathParts.length - 1];

    // GET requests are public (no auth required)
    if (method === "GET") {
      if (roomId && roomId !== "rooms") {
        return await getRoom(roomId, supabase, corsHeaders);
      } else {
        return await listRooms(url, supabase, corsHeaders);
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
      return await createRoom(req, supabase, user, corsHeaders);
    } else if (method === "PATCH") {
      return await updateRoom(roomId, req, supabase, user, corsHeaders);
    } else if (method === "DELETE") {
      return await deleteRoom(roomId, supabase, user, corsHeaders);
    }

    return errorResponse("Method not allowed", 405, corsHeaders);
  } catch (error) {
    console.error(error);
    return errorResponse(error.message, 500, corsHeaders);
  }
});

async function listRooms(url: URL, supabase: any, headers: any) {
  const branchId = url.searchParams.get("branchId");

  if (!branchId) {
    return errorResponse("Missing branchId", 400, headers);
  }

  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("branch_id", branchId)
    .eq("status", "active")
    .order("name");

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 200, headers);
}

async function getRoom(roomId: string, supabase: any, headers: any) {
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", roomId)
    .eq("status", "active")
    .single();

  if (error) {
    return errorResponse("Room not found", 404, headers);
  }

  return successResponse(data, 200, headers);
}

async function createRoom(req: Request, supabase: any, user: any, headers: any) {
  const body = await req.json();

  const { branch_id, name, game_type, capacity, booking_mode, hourly_rate, amenities } = body;

  if (!branch_id || !name || !game_type || !capacity || !booking_mode || !hourly_rate) {
    return errorResponse("Missing required fields", 400, headers);
  }

  if (!["WholeRoom", "PerSeat"].includes(booking_mode)) {
    return errorResponse("Invalid booking_mode. Must be 'WholeRoom' or 'PerSeat'", 400, headers);
  }

  // Verify user can create rooms in this branch
  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("role, branch_id, organization_id")
    .eq("id", user.id)
    .single();

  if (!staff || !["SuperAdmin", "OrgAdmin", "BranchManager"].includes(staff.role)) {
    return errorResponse("Unauthorized", 403, headers);
  }

  if (staff.role === "BranchManager" && staff.branch_id !== branch_id) {
    return errorResponse("Can only create rooms in your branch", 403, headers);
  }

  const { data, error } = await supabase
    .from("rooms")
    .insert({
      branch_id,
      name,
      game_type,
      capacity,
      booking_mode,
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

async function updateRoom(roomId: string, req: Request, supabase: any, user: any, headers: any) {
  const body = await req.json();

  // Verify user can update this room
  const { data: room } = await supabase
    .from("rooms")
    .select("branch_id")
    .eq("id", roomId)
    .single();

  if (!room) {
    return errorResponse("Room not found", 404, headers);
  }

  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("role, branch_id")
    .eq("id", user.id)
    .single();

  if (!staff || !["SuperAdmin", "OrgAdmin", "BranchManager"].includes(staff.role)) {
    return errorResponse("Unauthorized", 403, headers);
  }

  if (staff.role === "BranchManager" && staff.branch_id !== room.branch_id) {
    return errorResponse("Can only update rooms in your branch", 403, headers);
  }

  const { data, error } = await supabase
    .from("rooms")
    .update(body)
    .eq("id", roomId)
    .select()
    .single();

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 200, headers);
}

async function deleteRoom(roomId: string, supabase: any, user: any, headers: any) {
  // Soft delete: set status to suspended
  const { data: room } = await supabase
    .from("rooms")
    .select("branch_id")
    .eq("id", roomId)
    .single();

  if (!room) {
    return errorResponse("Room not found", 404, headers);
  }

  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("role, branch_id")
    .eq("id", user.id)
    .single();

  if (!staff || !["SuperAdmin", "OrgAdmin", "BranchManager"].includes(staff.role)) {
    return errorResponse("Unauthorized", 403, headers);
  }

  if (staff.role === "BranchManager" && staff.branch_id !== room.branch_id) {
    return errorResponse("Can only delete rooms in your branch", 403, headers);
  }

  const { error } = await supabase
    .from("rooms")
    .update({ status: "suspended" })
    .eq("id", roomId);

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse({ message: "Room deleted" }, 200, headers);
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
