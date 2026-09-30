# Supabase Quick Start for Booking Hub

## 1. Initial Setup

### Create Supabase Project
1. Go to [supabase.com](https://supabase.com) → sign up / sign in
2. Create a new project
3. Choose PostgreSQL version 15+ (recommended)
4. Note your **Project URL** and **API Key** (anon key for frontend, service role key for backend)
5. Store these in a `.env.local` file (never commit to git)

### Install Supabase CLI
```bash
npm install -g supabase
# or
brew install supabase/tap/supabase  # macOS
```

### Initialize Local Dev Environment
```bash
cd c:\Users\Abdul Hadi\OneDrive\Desktop\Backend

# Link to your Supabase project (you'll be prompted to choose a project)
supabase link

# Start local Supabase stack (postgres, vector, realtime, etc.)
supabase start

# You'll see connection strings printed — save them for local testing
```

---

## 2. Create Database Schema

### Option A: SQL Editor (Fastest)
1. Go to Supabase Dashboard → SQL Editor
2. Copy-paste all SQL from BACKEND_SPEC.md Section 2 into a new query
3. Click "Run"

### Option B: Migrations (Recommended for Team)
Create numbered migration files:

```bash
supabase migration new initial_schema
```

This creates `supabase/migrations/20240101120000_initial_schema.sql`. Paste all the schema SQL into it, then:

```bash
supabase db push
```

---

## 3. Initialize Supabase Auth

### Enable Auth Providers

**In Supabase Dashboard:**
1. Go to Authentication → Providers
2. Enable "Email" (default, already on)
3. Enable "Google" → add your Google OAuth credentials
4. Enable "Facebook" → add your Facebook App credentials
5. Enable "Microsoft" (optional)

### Configure Site URL
In Authentication → URL Configuration:
- **Site URL:** `http://localhost:3000` (local) or `https://yourdomain.com` (production)
- **Redirect URLs:** Add your login callback routes:
  - `http://localhost:3000/auth/callback`
  - `https://yourdomain.com/auth/callback`

---

## 4. Create First Edge Function

### Bookings Function
```bash
supabase functions new bookings
```

Creates `supabase/functions/bookings/index.ts`. Edit it:

```typescript
// supabase/functions/bookings/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    // Get authenticated user
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { method } = req;

    // Route by method
    if (method === "POST") {
      return await createBooking(req, supabase, user);
    } else if (method === "GET") {
      return await getBookings(req, supabase, user);
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

async function createBooking(req: Request, supabase: any, user: any) {
  const body = await req.json();
  
  // Validate input
  if (!body.court_id && !body.room_id && !body.seat_id) {
    return new Response(
      JSON.stringify({ error: "Must specify court_id, room_id, or seat_id" }),
      { status: 400 }
    );
  }

  // Insert booking
  const { data, error } = await supabase
    .from("bookings")
    .insert({
      court_id: body.court_id,
      room_id: body.room_id,
      seat_id: body.seat_id,
      member_id: user.id,
      start_time: body.start_time,
      end_time: body.end_time,
      payment_method: body.payment_method || "Card",
      status: "Pending",
      price: body.price || 0,
      total: body.total || body.price || 0,
      currency: body.currency || "PKR",
    })
    .select()
    .single();

  if (error) {
    const statusCode = error.code === "23505" ? 409 : 400; // Conflict if duplicate slot
    return new Response(JSON.stringify({ error: error.message }), { status: statusCode });
  }

  return new Response(JSON.stringify(data), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
}

async function getBookings(req: Request, supabase: any, user: any) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  
  let query = supabase
    .from("bookings")
    .select("*")
    .eq("member_id", user.id)
    .order("start_time", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }

  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}
```

### Test Locally
```bash
# Terminal 1: Start Supabase
supabase start

# Terminal 2: Serve Edge Functions
supabase functions serve --no-verify-jwt

# Terminal 3: Test the function
curl -X POST http://localhost:54321/functions/v1/bookings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt-token>" \
  -d '{"court_id": "uuid-here", "start_time": "2024-01-20T10:00:00Z", "end_time": "2024-01-20T11:00:00Z"}'
```

---

## 5. Create Remaining Edge Functions

Repeat the pattern above for:

```bash
supabase functions new auth          # Member registration, staff creation
supabase functions new courts        # CRUD courts
supabase functions new rooms         # CRUD rooms
supabase functions new availability  # Slot availability calculation
supabase functions new payments      # Payment intent, webhook callbacks
supabase functions new packages      # Package listing, purchase
supabase functions new wallet        # Wallet balance, credits, debits
supabase functions new notifications # Notification sending (Resend, WhatsApp)
```

Each function follows the same pattern:
1. Authenticate user from JWT
2. Parse request (GET params, POST body)
3. Query/mutate database
4. Return JSON response with appropriate status codes

---

## 6. Seed Data (Development)

Create `supabase/seed.sql`:

```sql
-- Insert test organization
INSERT INTO organizations (id, name, type, status, created_at)
VALUES (
  '550e8400-e29b-41d4-a716-446655440000'::uuid,
  'Test Org',
  'Sports',
  'active',
  NOW()
);

-- Insert test branch
INSERT INTO branches (id, organization_id, name, venue_type, status, default_currency)
VALUES (
  '550e8400-e29b-41d4-a716-446655440001'::uuid,
  '550e8400-e29b-41d4-a716-446655440000'::uuid,
  'Test Branch',
  'Court',
  'active',
  'PKR'
);

-- Insert test court
INSERT INTO courts (id, branch_id, name, sport_type, hourly_rate)
VALUES (
  '550e8400-e29b-41d4-a716-446655440002'::uuid,
  '550e8400-e29b-41d4-a716-446655440001'::uuid,
  'Court 1',
  'tennis',
  5000.00
);

-- Insert court schedule (Mon-Fri, 9am-6pm, 60-min slots)
INSERT INTO court_schedules (id, court_id, day_of_week, open_time, close_time, slot_minutes)
VALUES
  ('550e8400-e29b-41d4-a716-446655440003'::uuid, '550e8400-e29b-41d4-a716-446655440002'::uuid, 1, '09:00'::time, '18:00'::time, 60),
  ('550e8400-e29b-41d4-a716-446655440004'::uuid, '550e8400-e29b-41d4-a716-446655440002'::uuid, 2, '09:00'::time, '18:00'::time, 60),
  ('550e8400-e29b-41d4-a716-446655440005'::uuid, '550e8400-e29b-41d4-a716-446655440002'::uuid, 3, '09:00'::time, '18:00'::time, 60),
  ('550e8400-e29b-41d4-a716-446655440006'::uuid, '550e8400-e29b-41d4-a716-446655440002'::uuid, 4, '09:00'::time, '18:00'::time, 60),
  ('550e8400-e29b-41d4-a716-446655440007'::uuid, '550e8400-e29b-41d4-a716-446655440002'::uuid, 5, '09:00'::time, '18:00'::time, 60);
```

Run it locally:
```bash
supabase db seed
```

Or paste into the SQL editor on production.

---

## 7. Environment Variables

### Local Development
Create `.env.local`:
```
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=eyJh... (from supabase start output)
SUPABASE_SERVICE_ROLE_KEY=eyJh... (from supabase start output)
```

### Production
Set in Supabase Dashboard → Project Settings → API:
- Copy the **Project URL** and **Anon Public Key** for frontend
- Copy the **Service Role Secret Key** for backend/Edge Functions

---

## 8. Deploy to Production

### First Time
```bash
supabase projects list  # Verify your project is linked

# Deploy all Edge Functions
supabase functions deploy

# Deploy schema changes
supabase db push
```

### Every Update
```bash
# Deploy specific function
supabase functions deploy bookings

# Or all functions
supabase functions deploy
```

---

## 9. Test the Integration

### Get a Member JWT
```bash
# Sign up a member
curl -X POST http://localhost:54321/auth/v1/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "Test123!"}'

# Log in to get token
curl -X POST http://localhost:54321/auth/v1/token?grant_type=password \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "Test123!"}'
```

### Create a Booking
```bash
curl -X POST http://localhost:54321/functions/v1/bookings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{
    "court_id": "550e8400-e29b-41d4-a716-446655440002",
    "start_time": "2024-02-01T10:00:00Z",
    "end_time": "2024-02-01T11:00:00Z",
    "payment_method": "Card",
    "price": 5000,
    "total": 5000
  }'
```

---

## 10. Monitoring

### Supabase Dashboard
- **Logs:** Realtime function execution logs
- **Database:** Query performance, size, backups
- **Auth:** User signups, login activity
- **API:** Request metrics, rate limiting
- **Realtime:** Active subscriptions, message throughput

### Alerts (Production)
Set up alerts in Supabase Dashboard:
- Database disk usage > 80%
- Auth signup spike
- High API latency
- Failed function executions

---

## Next: Implement Core Services

1. **PricingService** → `supabase/functions/pricing/`
2. **TaxService** → `supabase/functions/tax/`
3. **WalletService** → `supabase/functions/wallet/`
4. **PackageService** → `supabase/functions/packages/`
5. **NotificationService** → `supabase/functions/notifications/`
6. **PaymentService** → `supabase/functions/payments/`

Each is a TypeScript Edge Function following the same authentication + request/response pattern.

Good luck! 🚀

