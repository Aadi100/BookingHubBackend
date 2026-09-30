// supabase/functions/seats/index.ts
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
    const seatId = pathParts[pathParts.length - 1];

    if (method === "GET" && seatId && seatId !== "seats") {
      return await getSeat(seatId, supabase, corsHeaders);
    } else if (method === "GET") {
      return await listSeats(url, supabase, corsHeaders);
    } else if (method === "POST") {
      return await createSeat(req, supabase, user, corsHeaders);
    } else if (method === "PATCH") {
      return await updateSeat(seatId, req, supabase, user, corsHeaders);
    } else if (method === "DELETE") {
      return await deleteSeat(seatId, supabase, user, corsHeaders);
    }

    return errorResponse("Method not allowed", 405, corsHeaders);
  } catch (error) {
    console.error(error);
    return errorResponse(error.message, 500, corsHeaders);
  }
});

async function listSeats(url: URL, supabase: any, headers: any) {
  const roomId = url.searchParams.get("roomId");

  if (!roomId) {
    return errorResponse("Missing roomId", 400, headers);
  }

  const { data, error } = await supabase
    .from("seats")
    .select("*")
    .eq("room_id", roomId)
    .eq("status", "active")
    .order("label");

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 200, headers);
}

async function getSeat(seatId: string, supabase: any, headers: any) {
  const { data, error } = await supabase
    .from("seats")
    .select("*")
    .eq("id", seatId)
    .eq("status", "active")
    .single();

  if (error) {
    return errorResponse("Seat not found", 404, headers);
  }

  return successResponse(data, 200, headers);
}

async function createSeat(req: Request, supabase: any, user: any, headers: any) {
  const body = await req.json();

  const { room_id, label, hourly_rate } = body;

  if (!room_id || !label || !hourly_rate) {
    return errorResponse("Missing required fields", 400, headers);
  }

  // Verify room exists and user can create seats
  const { data: room } = await supabase
    .from("rooms")
    .select("branch_id")
    .eq("id", room_id)
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
    return errorResponse("Can only create seats in your branch", 403, headers);
  }

  const { data, error } = await supabase
    .from("seats")
    .insert({
      room_id,
      label,
      hourly_rate
    })
    .select()
    .single();

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 201, headers);
}

async function updateSeat(seatId: string, req: Request, supabase: any, user: any, headers: any) {
  const body = await req.json();

  // Verify user can update this seat
  const { data: seat } = await supabase
    .from("seats")
    .select("room_id")
    .eq("id", seatId)
    .single();

  if (!seat) {
    return errorResponse("Seat not found", 404, headers);
  }

  const { data: room } = await supabase
    .from("rooms")
    .select("branch_id")
    .eq("id", seat.room_id)
    .single();

  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("role, branch_id")
    .eq("id", user.id)
    .single();

  if (!staff || !["SuperAdmin", "OrgAdmin", "BranchManager"].includes(staff.role)) {
    return errorResponse("Unauthorized", 403, headers);
  }

  if (staff.role === "BranchManager" && staff.branch_id !== room.branch_id) {
    return errorResponse("Can only update seats in your branch", 403, headers);
  }

  const { data, error } = await supabase
    .from("seats")
    .update(body)
    .eq("id", seatId)
    .select()
    .single();

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 200, headers);
}

async function deleteSeat(seatId: string, supabase: any, user: any, headers: any) {
  const { data: seat } = await supabase
    .from("seats")
    .select("room_id")
    .eq("id", seatId)
    .single();

  if (!seat) {
    return errorResponse("Seat not found", 404, headers);
  }

  const { data: room } = await supabase
    .from("rooms")
    .select("branch_id")
    .eq("id", seat.room_id)
    .single();

  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("role, branch_id")
    .eq("id", user.id)
    .single();

  if (!staff || !["SuperAdmin", "OrgAdmin", "BranchManager"].includes(staff.role)) {
    return errorResponse("Unauthorized", 403, headers);
  }

  if (staff.role === "BranchManager" && staff.branch_id !== room.branch_id) {
    return errorResponse("Can only delete seats in your branch", 403, headers);
  }

  const { error } = await supabase
    .from("seats")
    .update({ status: "suspended" })
    .eq("id", seatId);

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse({ message: "Seat deleted" }, 200, headers);
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
