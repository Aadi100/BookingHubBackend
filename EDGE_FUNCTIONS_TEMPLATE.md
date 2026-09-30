# Supabase Edge Functions Template Patterns

Use these patterns to implement your Edge Functions consistently.

---

## 1. Base Pattern (All Functions)

```typescript
// supabase/functions/[function-name]/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    // Authenticate user from JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return errorResponse("Unauthorized", 401, corsHeaders);
    }

    // Route by method
    const { method, url } = req;
    const urlPath = new URL(url).pathname;

    if (method === "GET") {
      return await handleGet(req, supabase, user, corsHeaders);
    } else if (method === "POST") {
      return await handlePost(req, supabase, user, corsHeaders);
    } else if (method === "PATCH") {
      return await handlePatch(req, supabase, user, corsHeaders);
    } else if (method === "DELETE") {
      return await handleDelete(req, supabase, user, corsHeaders);
    }

    return errorResponse("Method not allowed", 405, corsHeaders);
  } catch (error) {
    console.error(error);
    return errorResponse(error.message, 500, corsHeaders);
  }
});

// Helper: Send successful response
function successResponse(data: any, statusCode = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status: statusCode,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

// Helper: Send error response
function errorResponse(message: string, statusCode = 400, headers = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status: statusCode,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

// Handlers (implement below)
async function handleGet(req: Request, supabase: any, user: any, headers: any) {
  // Implement GET logic
  return successResponse({}, 200, headers);
}

async function handlePost(req: Request, supabase: any, user: any, headers: any) {
  // Implement POST logic
  return successResponse({}, 201, headers);
}

async function handlePatch(req: Request, supabase: any, user: any, headers: any) {
  // Implement PATCH logic
  return successResponse({}, 200, headers);
}

async function handleDelete(req: Request, supabase: any, user: any, headers: any) {
  // Implement DELETE logic
  return successResponse({}, 204, headers);
}
```

---

## 2. Auth (Registration & Staff Creation)

```typescript
// supabase/functions/auth/index.ts
// Handles: POST /auth/members/register, POST /auth/staff/create, etc.

async function handlePost(req: Request, supabase: any, user: any, headers: any) {
  const body = await req.json();
  const url = new URL(req.url);
  const path = url.pathname;

  if (path.includes("members/register")) {
    return await registerMember(body, supabase, headers);
  } else if (path.includes("staff/create")) {
    // Only SuperAdmin or OrgAdmin can create staff
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "" // Service role for creating auth users
    );
    return await createStaff(body, supabase, adminClient, user, headers);
  }

  return errorResponse("Not found", 404, headers);
}

async function registerMember(body: any, supabase: any, headers: any) {
  const { name, email, password } = body;

  if (!name || !email || !password) {
    return errorResponse("Missing name, email, or password", 400, headers);
  }

  // 1. Sign up the member (creates auth.users entry)
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
}

async function createStaff(body: any, supabase: any, adminClient: any, user: any, headers: any) {
  // Check authorization (must be SuperAdmin or OrgAdmin)
  const { data: staffProfile } = await supabase
    .from("staff_profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!staffProfile || !["SuperAdmin", "OrgAdmin"].includes(staffProfile.role)) {
    return errorResponse("Only SuperAdmin or OrgAdmin can create staff", 403, headers);
  }

  const { name, email, password, role, organization_id, branch_id } = body;

  if (!name || !email || !password || !role) {
    return errorResponse("Missing required fields", 400, headers);
  }

  // 1. Create auth user (using service role key)
  const { data: { user: authUser }, error: signupError } = await adminClient.auth.admin.createUser({
    email,
    password,
    user_metadata: { full_name: name }
  });

  if (signupError) {
    return errorResponse(signupError.message, 400, headers);
  }

  // 2. Create staff profile
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
}
```

---

## 3. Availability (Slot Calculation)

```typescript
// supabase/functions/availability/index.ts
// GET /availability?courtId=xxx&date=2024-01-20

async function handleGet(req: Request, supabase: any, user: any, headers: any) {
  const url = new URL(req.url);
  const courtId = url.searchParams.get("courtId");
  const roomId = url.searchParams.get("roomId");
  const date = url.searchParams.get("date"); // YYYY-MM-DD

  if (!courtId && !roomId || !date) {
    return errorResponse("Missing courtId/roomId and date", 400, headers);
  }

  try {
    if (courtId) {
      return await getCourtAvailability(courtId, date, supabase, headers);
    } else {
      return await getRoomAvailability(roomId, date, supabase, headers);
    }
  } catch (error) {
    return errorResponse(error.message, 500, headers);
  }
}

async function getCourtAvailability(courtId: string, dateStr: string, supabase: any, headers: any) {
  const date = new Date(dateStr);
  const dayOfWeek = date.getDay();

  // 1. Get court + schedule
  const { data: court } = await supabase
    .from("courts")
    .select("*")
    .eq("id", courtId)
    .single();

  if (!court) return errorResponse("Court not found", 404, headers);

  const { data: schedule } = await supabase
    .from("court_schedules")
    .select("*")
    .eq("court_id", courtId)
    .eq("day_of_week", dayOfWeek)
    .single();

  if (!schedule) {
    return successResponse({ date: dateStr, slots: [], reason: "Closed on this day" }, 200, headers);
  }

  // 2. Check for exception (holiday, surge pricing)
  const { data: exception } = await supabase
    .from("court_exceptions")
    .select("*")
    .eq("court_id", courtId)
    .eq("date", dateStr)
    .single();

  if (exception?.is_closed) {
    return successResponse({ date: dateStr, slots: [], reason: exception.reason }, 200, headers);
  }

  // 3. Get existing bookings for this date
  const startOfDay = new Date(date).setHours(0, 0, 0, 0);
  const endOfDay = new Date(date).setHours(23, 59, 59, 999);

  const { data: bookings } = await supabase
    .from("bookings")
    .select("start_time, end_time")
    .eq("court_id", courtId)
    .in("status", ["Pending", "Confirmed"])
    .gte("start_time", new Date(startOfDay).toISOString())
    .lt("end_time", new Date(endOfDay).toISOString());

  // 4. Generate slots
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

function generateSlots(openTime: string, closeTime: string, slotMinutes: number, date: Date, bookings: any[], hourlyRate: number) {
  const slots = [];
  const [openHour, openMin] = openTime.split(':').map(Number);
  const [closeHour, closeMin] = closeTime.split(':').map(Number);

  let currentTime = new Date(date);
  currentTime.setHours(openHour, openMin, 0, 0);

  const closeDateTime = new Date(date);
  closeDateTime.setHours(closeHour, closeMin, 0, 0);

  while (currentTime < closeDateTime) {
    const slotEnd = new Date(currentTime.getTime() + slotMinutes * 60 * 1000);

    if (slotEnd > closeDateTime) break;

    // Check if slot conflicts with any booking
    const isBooked = bookings.some(b => {
      const bookStart = new Date(b.start_time);
      const bookEnd = new Date(b.end_time);
      return currentTime < bookEnd && slotEnd > bookStart;
    });

    // Calculate price for this slot
    const durationHours = slotMinutes / 60;
    const price = Math.round(hourlyRate * durationHours * 100) / 100; // Round to 2 decimals

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
```

---

## 4. Bookings (Create & List)

```typescript
// supabase/functions/bookings/index.ts

async function handlePost(req: Request, supabase: any, user: any, headers: any) {
  const body = await req.json();

  const { court_id, room_id, seat_id, start_time, end_time, payment_method, member_package_id } = body;

  // Validate
  if (!start_time || !end_time) {
    return errorResponse("Missing start_time or end_time", 400, headers);
  }

  if (!court_id && !room_id && !seat_id) {
    return errorResponse("Must specify court_id, room_id, or seat_id", 400, headers);
  }

  try {
    // 1. Get branch (from court/room/seat → branch)
    let branchId: string;
    if (court_id) {
      const { data: court } = await supabase.from("courts").select("branch_id").eq("id", court_id).single();
      branchId = court.branch_id;
    } else if (room_id) {
      const { data: room } = await supabase.from("rooms").select("branch_id").eq("id", room_id).single();
      branchId = room.branch_id;
    } else {
      const { data: seat } = await supabase.from("seats").select("room_id").eq("id", seat_id).single();
      const { data: room } = await supabase.from("rooms").select("branch_id").eq("id", seat.room_id).single();
      branchId = room.branch_id;
    }

    // 2. Calculate price
    const price = await calculatePrice(court_id || room_id || seat_id, start_time, end_time, supabase);

    // 3. Apply package if specified
    let finalPrice = price;
    if (member_package_id) {
      finalPrice = await redeemPackage(member_package_id, user.id, price, supabase);
    }

    // 4. Calculate tax
    const tax = await calculateTax(branchId, finalPrice, supabase);

    // 5. Insert booking (unique index will throw on conflict)
    const { data: booking, error } = await supabase
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

    if (error) {
      if (error.code === "23505") { // Unique constraint violation
        return errorResponse("This time slot is already booked", 409, headers);
      }
      return errorResponse(error.message, 400, headers);
    }

    // 6. If wallet payment, debit wallet
    if (payment_method === "Wallet") {
      const walletError = await debitWallet(user.id, tax.total, "BookingPayment", booking.id, supabase);
      if (walletError) {
        // Rollback booking? For now, return error (ideally use transaction)
        return errorResponse(walletError, 402, headers); // 402 Payment Required
      }
    }

    return successResponse(booking, 201, headers);
  } catch (error) {
    return errorResponse(error.message, 500, headers);
  }
}

async function handleGet(req: Request, supabase: any, user: any, headers: any) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const courtId = url.searchParams.get("courtId");

  let query = supabase
    .from("bookings")
    .select("*")
    .eq("member_id", user.id)
    .order("start_time", { ascending: false });

  if (status) query = query.eq("status", status);
  if (courtId) query = query.eq("court_id", courtId);

  const { data, error } = await query;

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 200, headers);
}

async function calculatePrice(bookableId: string, startTime: string, endTime: string, supabase: any): Promise<number> {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

  // Determine hourly rate (court, room, or seat)
  // Simplified: assume it's a court (can be extended)
  const { data: court } = await supabase.from("courts").select("hourly_rate").eq("id", bookableId).single();
  if (!court) {
    const { data: room } = await supabase.from("rooms").select("hourly_rate").eq("id", bookableId).single();
    if (!room) {
      const { data: seat } = await supabase.from("seats").select("hourly_rate").eq("id", bookableId).single();
      return Math.round(seat.hourly_rate * durationHours * 100) / 100;
    }
    return Math.round(room.hourly_rate * durationHours * 100) / 100;
  }

  return Math.round(court.hourly_rate * durationHours * 100) / 100;
}

async function calculateTax(branchId: string, subtotal: number, supabase: any) {
  const { data: branch } = await supabase
    .from("branches")
    .select("tax_enabled, tax_rate_percent, default_currency")
    .eq("id", branchId)
    .single();

  if (!branch.tax_enabled || subtotal === 0) {
    return { rate_percent: 0, amount: 0, total: subtotal, currency: branch.default_currency };
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

  // Simplified: assume FixedSessions (can be extended for other types)
  if (memberPackage.sessions_remaining > 0) {
    await supabase
      .from("member_packages")
      .update({ sessions_remaining: memberPackage.sessions_remaining - 1 })
      .eq("id", packageId);
    return 0; // Fully covered
  }

  throw new Error("No sessions remaining");
}

async function debitWallet(memberId: string, amount: number, reason: string, bookingId: string, supabase: any): Promise<string | null> {
  // Get wallet
  const { data: wallet } = await supabase
    .from("wallets")
    .select("balance")
    .eq("member_id", memberId)
    .single();

  if (!wallet || wallet.balance < amount) {
    return "Insufficient wallet balance";
  }

  // Debit
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

  // Update wallet balance
  await supabase
    .from("wallets")
    .update({ balance: wallet.balance - amount })
    .eq("member_id", memberId);

  return null;
}
```

---

## 5. Error Handling Pattern

```typescript
// All Edge Functions should follow this error pattern:

type ApiResponse<T> = {
  data?: T;
  error?: string;
  status: number;
};

function successResponse<T>(data: T, statusCode = 200, headers = {}) {
  return new Response(JSON.stringify({ data, status: statusCode }), {
    status: statusCode,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, statusCode = 400, headers = {}) {
  console.error(`[${statusCode}] ${message}`);
  return new Response(JSON.stringify({ error: message, status: statusCode }), {
    status: statusCode,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

// Usage:
if (!user) return errorResponse("Unauthorized", 401, corsHeaders);
if (error.code === "23505") return errorResponse("Duplicate slot", 409, corsHeaders);
if (wallet.balance < amount) return errorResponse("Insufficient funds", 402, corsHeaders);
```

---

## Testing Edge Functions Locally

```bash
# Terminal 1: Start Supabase
supabase start

# Terminal 2: Serve Edge Functions
supabase functions serve --no-verify-jwt

# Terminal 3: Test via curl

# Get JWT token
TOKEN=$(curl -s -X POST http://localhost:54321/auth/v1/token?grant_type=password \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "Test123!"}' | jq -r '.access_token')

# Call Edge Function
curl -X GET http://localhost:54321/functions/v1/availability?courtId=xxx&date=2024-01-20 \
  -H "Authorization: Bearer $TOKEN"
```

---

## Deployment Checklist

- [ ] All functions handle CORS (preflight OPTIONS)
- [ ] All functions authenticate user from JWT
- [ ] All functions validate input (required fields, types)
- [ ] All functions return appropriate HTTP status codes
- [ ] All functions handle errors gracefully
- [ ] All functions use service role key only when necessary (e.g., creating auth users)
- [ ] All database errors are caught and returned as JSON
- [ ] All sensitive data (API keys, credentials) come from environment variables

Deploy with:
```bash
supabase functions deploy
```

