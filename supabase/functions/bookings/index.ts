// supabase/functions/bookings/index.ts
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

    if (method === "POST") {
      return await createBooking(req, supabase, user, corsHeaders);
    } else if (method === "GET") {
      return await getBookings(req, supabase, user, corsHeaders);
    } else if (method === "PATCH") {
      return await cancelBooking(req, supabase, user, corsHeaders);
    }

    return errorResponse("Method not allowed", 405, corsHeaders);
  } catch (error) {
    console.error(error);
    return errorResponse(error.message, 500, corsHeaders);
  }
});

async function createBooking(req: Request, supabase: any, user: any, headers: any) {
  const body = await req.json();

  const { court_id, room_id, seat_id, start_time, end_time, payment_method, member_package_id, branch_id } = body;

  if (!start_time || !end_time) {
    return errorResponse("Missing start_time or end_time", 400, headers);
  }

  if (!court_id && !room_id && !seat_id) {
    return errorResponse("Must specify court_id, room_id, or seat_id", 400, headers);
  }

  if (!branch_id) {
    return errorResponse("Missing branch_id", 400, headers);
  }

  try {
    // 1. Calculate price
    const price = await calculatePrice(court_id || room_id || seat_id, start_time, end_time, supabase);

    // 2. Apply package if specified
    let finalPrice = price;
    if (member_package_id) {
      finalPrice = await redeemPackage(member_package_id, user.id, price, supabase);
    }

    // 3. Calculate tax
    const tax = await calculateTax(branch_id, finalPrice, supabase);

    // 4. Insert booking
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .insert({
        court_id,
        room_id,
        seat_id,
        member_id: user.id,
        member_package_id,
        start_time,
        end_time,
        payment_method: payment_method || "Card",
        status: payment_method === "Wallet" ? "Confirmed" : "Pending",
        price: finalPrice,
        tax_amount: tax.amount,
        tax_rate_percent: tax.rate_percent,
        total: tax.total,
        currency: tax.currency
      })
      .select()
      .single();

    if (bookingError) {
      if (bookingError.code === "23505") {
        return errorResponse("This time slot is already booked", 409, headers);
      }
      return errorResponse(bookingError.message, 400, headers);
    }

    // 5. If wallet payment, debit wallet
    if (payment_method === "Wallet") {
      const walletError = await debitWallet(user.id, tax.total, "BookingPayment", booking.id, supabase);
      if (walletError) {
        return errorResponse(walletError, 402, headers); // 402 Payment Required
      }
    }

    return successResponse(booking, 201, headers);
  } catch (error) {
    return errorResponse(error.message, 500, headers);
  }
}

async function getBookings(req: Request, supabase: any, user: any, headers: any) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const court_id = url.searchParams.get("courtId");

  let query = supabase
    .from("bookings")
    .select("*")
    .eq("member_id", user.id)
    .order("start_time", { ascending: false });

  if (status) query = query.eq("status", status);
  if (court_id) query = query.eq("court_id", court_id);

  const { data, error } = await query;

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 200, headers);
}

async function cancelBooking(req: Request, supabase: any, user: any, headers: any) {
  const url = new URL(req.url);
  const bookingId = url.pathname.split("/")[3]; // /bookings/{id}/cancel

  if (!bookingId) {
    return errorResponse("Missing booking ID", 400, headers);
  }

  const body = await req.json();
  const { reason } = body;

  try {
    // Get booking
    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .eq("member_id", user.id)
      .single();

    if (fetchError || !booking) {
      return errorResponse("Booking not found", 404, headers);
    }

    // Check if already cancelled
    if (["Cancelled", "Completed", "NoShow"].includes(booking.status)) {
      return errorResponse("Booking cannot be cancelled in its current state", 400, headers);
    }

    // Calculate refund
    const refundPercent = 100; // Simplified: 100% refund (implement tiered policy later)
    const refundAmount = Math.round(booking.total * (refundPercent / 100) * 100) / 100;

    // Update booking
    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        status: "Cancelled",
        cancelled_at: new Date().toISOString(),
        cancel_reason: reason
      })
      .eq("id", bookingId);

    if (updateError) {
      return errorResponse(updateError.message, 400, headers);
    }

    // If wallet payment, credit wallet
    if (booking.payment_method === "Wallet" && refundAmount > 0) {
      await creditWallet(user.id, refundAmount, "Refund", bookingId, supabase);
    }

    return successResponse({ message: "Booking cancelled" }, 200, headers);
  } catch (error) {
    return errorResponse(error.message, 500, headers);
  }
}

async function calculatePrice(bookableId: string, startTime: string, endTime: string, supabase: any): Promise<number> {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

  // Try court first
  const { data: court } = await supabase
    .from("courts")
    .select("hourly_rate")
    .eq("id", bookableId)
    .single();

  if (court) {
    return Math.round(court.hourly_rate * durationHours * 100) / 100;
  }

  // Try room
  const { data: room } = await supabase
    .from("rooms")
    .select("hourly_rate")
    .eq("id", bookableId)
    .single();

  if (room) {
    return Math.round(room.hourly_rate * durationHours * 100) / 100;
  }

  // Try seat
  const { data: seat } = await supabase
    .from("seats")
    .select("hourly_rate")
    .eq("id", bookableId)
    .single();

  if (seat) {
    return Math.round(seat.hourly_rate * durationHours * 100) / 100;
  }

  throw new Error("Bookable not found");
}

async function calculateTax(branchId: string, subtotal: number, supabase: any) {
  const { data: branch } = await supabase
    .from("branches")
    .select("tax_enabled, tax_rate_percent, default_currency")
    .eq("id", branchId)
    .single();

  if (!branch.tax_enabled || subtotal === 0) {
    return {
      rate_percent: 0,
      amount: 0,
      total: subtotal,
      currency: branch.default_currency
    };
  }

  const taxAmount = Math.round(subtotal * (branch.tax_rate_percent / 100) * 100) / 100;
  return {
    rate_percent: branch.tax_rate_percent,
    amount: taxAmount,
    total: subtotal + taxAmount,
    currency: branch.default_currency
  };
}

async function redeemPackage(packageId: string, memberId: string, price: number, supabase: any): Promise<number> {
  const { data: memberPackage } = await supabase
    .from("member_packages")
    .select("package_id, status, expires_at, sessions_remaining, hours_remaining")
    .eq("id", packageId)
    .eq("member_id", memberId)
    .single();

  if (!memberPackage || memberPackage.status !== "active" || new Date(memberPackage.expires_at) < new Date()) {
    throw new Error("Package not available");
  }

  // Simplified: assume FixedSessions
  if (memberPackage.sessions_remaining > 0) {
    await supabase
      .from("member_packages")
      .update({ sessions_remaining: memberPackage.sessions_remaining - 1 })
      .eq("id", packageId);
    return 0;
  }

  throw new Error("No sessions remaining");
}

async function debitWallet(memberId: string, amount: number, reason: string, bookingId: string, supabase: any): Promise<string | null> {
  const { data: wallet } = await supabase
    .from("wallets")
    .select("balance")
    .eq("member_id", memberId)
    .single();

  if (!wallet || wallet.balance < amount) {
    return "Insufficient wallet balance";
  }

  const { error } = await supabase
    .from("wallet_debits")
    .insert({
      member_id: memberId,
      reason,
      amount,
      balance_after: wallet.balance - amount,
      reference: "Booking payment",
      booking_id: bookingId
    });

  if (error) return error.message;

  await supabase
    .from("wallets")
    .update({ balance: wallet.balance - amount })
    .eq("member_id", memberId);

  return null;
}

async function creditWallet(memberId: string, amount: number, reason: string, bookingId: string, supabase: any) {
  const { data: wallet } = await supabase
    .from("wallets")
    .select("balance")
    .eq("member_id", memberId)
    .single();

  await supabase
    .from("wallet_credits")
    .insert({
      member_id: memberId,
      reason,
      amount,
      balance_after: wallet.balance + amount,
      reference: "Booking cancellation",
      booking_id: bookingId
    });

  await supabase
    .from("wallets")
    .update({ balance: wallet.balance + amount })
    .eq("member_id", memberId);
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
