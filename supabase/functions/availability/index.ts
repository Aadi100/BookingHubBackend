// supabase/functions/availability/index.ts
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

    if (req.method === "GET") {
      return await getAvailability(req, supabase, corsHeaders);
    }

    return errorResponse("Method not allowed", 405, corsHeaders);
  } catch (error) {
    console.error(error);
    return errorResponse(error.message, 500, corsHeaders);
  }
});

async function getAvailability(req: Request, supabase: any, headers: any) {
  const url = new URL(req.url);
  const courtId = url.searchParams.get("courtId");
  const roomId = url.searchParams.get("roomId");
  const dateStr = url.searchParams.get("date");

  if (!courtId && !roomId || !dateStr) {
    return errorResponse("Missing courtId/roomId and date", 400, headers);
  }

  try {
    if (courtId) {
      return await getCourtAvailability(courtId, dateStr, supabase, headers);
    } else {
      return await getRoomAvailability(roomId, dateStr, supabase, headers);
    }
  } catch (error) {
    return errorResponse(error.message, 500, headers);
  }
}

async function getCourtAvailability(courtId: string, dateStr: string, supabase: any, headers: any) {
  const date = new Date(dateStr);
  const dayOfWeek = date.getDay();

  // Get court
  const { data: court } = await supabase
    .from("courts")
    .select("*")
    .eq("id", courtId)
    .single();

  if (!court) return errorResponse("Court not found", 404, headers);

  // Get schedule for this day
  const { data: schedule } = await supabase
    .from("court_schedules")
    .select("*")
    .eq("court_id", courtId)
    .eq("day_of_week", dayOfWeek)
    .single();

  if (!schedule) {
    return successResponse({ date: dateStr, slots: [], reason: "Closed on this day" }, 200, headers);
  }

  // Check for exception
  const { data: exception } = await supabase
    .from("court_exceptions")
    .select("*")
    .eq("court_id", courtId)
    .eq("date", dateStr)
    .single();

  if (exception?.is_closed) {
    return successResponse({ date: dateStr, slots: [], reason: exception.reason }, 200, headers);
  }

  // Get existing bookings for this date
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const { data: bookings } = await supabase
    .from("bookings")
    .select("start_time, end_time")
    .eq("court_id", courtId)
    .in("status", ["Pending", "Confirmed"])
    .gte("start_time", startOfDay.toISOString())
    .lt("end_time", endOfDay.toISOString());

  // Generate slots
  const slots = generateSlots(
    schedule.open_time,
    schedule.close_time,
    schedule.slot_minutes,
    date,
    bookings || [],
    exception?.price_override || court.hourly_rate
  );

  return successResponse({ date: dateStr, slots }, 200, headers);
}

async function getRoomAvailability(roomId: string, dateStr: string, supabase: any, headers: any) {
  const date = new Date(dateStr);
  const dayOfWeek = date.getDay();

  // Get room
  const { data: room } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", roomId)
    .single();

  if (!room) return errorResponse("Room not found", 404, headers);

  // Get schedule
  const { data: schedule } = await supabase
    .from("room_schedules")
    .select("*")
    .eq("room_id", roomId)
    .eq("day_of_week", dayOfWeek)
    .single();

  if (!schedule) {
    return successResponse({
      date: dateStr,
      booking_mode: room.booking_mode,
      slots: [],
      reason: "Closed on this day"
    }, 200, headers);
  }

  // Check for exception
  const { data: exception } = await supabase
    .from("room_exceptions")
    .select("*")
    .eq("room_id", roomId)
    .eq("date", dateStr)
    .single();

  if (exception?.is_closed) {
    return successResponse({
      date: dateStr,
      booking_mode: room.booking_mode,
      slots: [],
      reason: exception.reason
    }, 200, headers);
  }

  // Get existing bookings
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const { data: bookings } = await supabase
    .from("bookings")
    .select("start_time, end_time")
    .eq("room_id", roomId)
    .in("status", ["Pending", "Confirmed"])
    .gte("start_time", startOfDay.toISOString())
    .lt("end_time", endOfDay.toISOString());

  if (room.booking_mode === "WholeRoom") {
    // Treat like a court
    const slots = generateSlots(
      schedule.open_time,
      schedule.close_time,
      schedule.slot_minutes,
      date,
      bookings || [],
      exception?.price_override || room.hourly_rate
    );

    return successResponse({ date: dateStr, booking_mode: room.booking_mode, slots }, 200, headers);
  } else {
    // PerSeat: generate slots for each seat
    const { data: seats } = await supabase
      .from("seats")
      .select("*")
      .eq("room_id", roomId)
      .eq("status", "active");

    const seatsWithSlots = seats.map((seat) => ({
      seat_id: seat.id,
      label: seat.label,
      slots: generateSlots(
        schedule.open_time,
        schedule.close_time,
        schedule.slot_minutes,
        date,
        bookings?.filter((b) => b.seat_id === seat.id) || [],
        seat.hourly_rate
      )
    }));

    return successResponse({
      date: dateStr,
      booking_mode: room.booking_mode,
      seats: seatsWithSlots
    }, 200, headers);
  }
}

function generateSlots(
  openTime: string,
  closeTime: string,
  slotMinutes: number,
  date: Date,
  bookings: any[],
  hourlyRate: number
) {
  const slots = [];
  const [openHour, openMin] = openTime.split(":").map(Number);
  const [closeHour, closeMin] = closeTime.split(":").map(Number);

  let currentTime = new Date(date);
  currentTime.setHours(openHour, openMin, 0, 0);

  const closeDateTime = new Date(date);
  closeDateTime.setHours(closeHour, closeMin, 0, 0);

  while (currentTime < closeDateTime) {
    const slotEnd = new Date(currentTime.getTime() + slotMinutes * 60 * 1000);

    if (slotEnd > closeDateTime) break;

    // Check if slot conflicts with any booking
    const isBooked = bookings.some((b) => {
      const bookStart = new Date(b.start_time);
      const bookEnd = new Date(b.end_time);
      return currentTime < bookEnd && slotEnd > bookStart;
    });

    // Calculate price for this slot
    const durationHours = slotMinutes / 60;
    const price = Math.round(hourlyRate * durationHours * 100) / 100;

    slots.push({
      start: currentTime.toISOString(),
      end: slotEnd.toISOString(),
      price,
      status: isBooked ? "booked" : "available"
    });

    currentTime = slotEnd;
  }

  return slots;
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
