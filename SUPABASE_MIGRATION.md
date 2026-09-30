# Booking Hub: ASP.NET → Supabase Migration Summary

## What Changed

Your backend specification has been updated from **ASP.NET Core MVC/C# + SQL Server** to **Supabase + PostgreSQL + Edge Functions (TypeScript)**.

### High-Level Architecture

| Aspect | Before (ASP.NET) | Now (Supabase) |
|--------|------------------|---|
| **Database** | SQL Server with EF Core | PostgreSQL (managed by Supabase) |
| **API Framework** | ASP.NET Core Web API (Controllers) | Supabase Edge Functions (Deno/TypeScript) |
| **Authentication** | ASP.NET Core Identity | Supabase Auth (managed JWT) |
| **Authorization** | Custom handlers + role claims | PostgreSQL Row-Level Security (RLS) policies |
| **Real-time** | SignalR (optional) | Supabase Realtime subscriptions (optional) |
| **Deployment** | Azure App Service / IIS | Supabase (serverless, auto-scaling) |

---

## Key Changes in BACKEND_SPEC.md

### 1. Project Structure (Section 1)
**Before:**
```
BookingHub.sln
 ├─ BookingHub.Api/              (ASP.NET Core project)
 ├─ BookingHub.Domain/           (C# entities)
 ├─ BookingHub.Infrastructure/   (EF Core DbContext)
 └─ BookingHub.Application/      (C# services)
```

**Now:**
```
supabase/
 ├─ migrations/           (numbered PostgreSQL files: 001_initial_schema.sql)
 ├─ functions/            (TypeScript Edge Functions: bookings.ts, courts.ts)
 ├─ seed.sql              (optional: seed data)
 └─ config.toml           (Supabase local dev config)
```

### 2. Database Schema (Section 2)
**Before:** C# classes (EF Core entities)
**Now:** PostgreSQL SQL (`CREATE TABLE`, `CREATE INDEX`, `CREATE POLICY`)

#### Key additions:
- **Row-Level Security (RLS) policies** on every table for authorization
- **Filtered unique indexes** for double-booking prevention (same logic, native PostgreSQL)
- **CHECK constraints** for enum-like fields (e.g., `status IN ('active', 'inactive')`)
- **Foreign keys** (same as before, now in SQL)
- **Append-only ledger tables** (`wallet_credits`, `wallet_debits`) — unchanged from original spec

#### New table: `branch_payment_providers`
Stores per-branch payment gateway config (Stripe, JazzCash, EasyPaisa, PayFast, etc.) with encrypted credentials.

### 3. Authentication (Section 3)
**Before:** ASP.NET Core Identity (on-premises user management)
**Now:** Supabase Auth (managed service)

**Key changes:**
- JWT tokens issued by Supabase, not your code
- Staff roles/organization/branch stored in `user_metadata`
- Password reset handled by Supabase (no custom email logic needed)
- Social login (Google/Facebook/Microsoft) configured once in Supabase dashboard

### 4. Authorization (Section 4)
**Before:** Custom `IAuthorizationHandler` + role claims in JWT
**Now:** PostgreSQL RLS policies + Supabase `auth` context

RLS policies on each table ensure:
- Members see only their own bookings/wallet
- Staff see resources in their organization/branch
- SuperAdmin sees everything

### 5. API Endpoints (Section 5)
**Before:** ASP.NET controllers returning JSON
**Now:** Supabase Edge Functions returning JSON

The REST API surface is **identical** — same endpoints, same request/response shapes. Only the implementation changes:
- Controllers → TypeScript functions
- `DbContext.SaveChangesAsync()` → `supabase.rpc('function_name')` or direct table mutations

---

## Migration Checklist

### 1. **Set up Supabase project**
   - [ ] Create a Supabase project at supabase.com
   - [ ] Note your project URL and API key
   - [ ] Enable necessary providers (Google, Facebook, etc.) in Auth settings
   - [ ] Configure SITE_URL for password reset / social login callbacks

### 2. **Create database schema**
   - [ ] Run migrations in `supabase/migrations/` (or copy-paste the SQL from BACKEND_SPEC.md Section 2 into the Supabase SQL editor)
   - [ ] Verify all tables exist: `auth.users`, `organizations`, `branches`, `courts`, `bookings`, etc.

### 3. **Implement Edge Functions**
   - [ ] Create `supabase/functions/bookings.ts` for booking operations
   - [ ] Create `supabase/functions/payments.ts` for payment processing
   - [ ] Create `supabase/functions/auth.ts` for member registration/staff creation
   - [ ] Create `supabase/functions/availability.ts` for slot availability
   - [ ] etc. (one function per resource, or multiplex by HTTP method)

### 4. **Seed data (optional)**
   - [ ] Run `supabase/seed.sql` to populate test organizations, branches, courts, rooms for development

### 5. **Update frontend**
   - [ ] Point `src/services/*` API calls to your Supabase URL
   - [ ] Replace mock functions with real Edge Function calls
   - [ ] Update Supabase client initialization (see `src/lib/supabase.ts` pattern)

### 6. **Background jobs**
   - [ ] Implement `AbandonedBookingCleanupJob` using Supabase scheduled functions (or external job runner like Inngest)
   - [ ] Implement `NotificationDispatchJob` (Resend/WhatsApp senders)
   - [ ] Implement `FbrInvoicingService` (tax filing)

### 7. **Testing**
   - [ ] Unit test business logic (pricing, wallet, package redemption) in TypeScript/Deno
   - [ ] Integration test Edge Functions against local Supabase (use `supabase functions serve`)
   - [ ] Test RLS policies (ensure members can't read other members' bookings)

---

## Supabase CLI Quick Start

```bash
# Install Supabase CLI
npm install -g supabase

# Initialize local development (creates supabase/ folder)
supabase init

# Link to your Supabase project
supabase link --project-ref <your-project-ref>

# Start local dev server
supabase start

# Run migrations locally
supabase db push

# Create a new Edge Function
supabase functions new bookings

# Deploy functions to production
supabase functions deploy
```

---

## Key Implementation Notes

### Booking Creation (Section 5)
**Original logic (unchanged):**
1. Calculate price → apply package → calculate tax
2. Insert booking (unique index prevents double-booking)
3. If wallet payment, debit wallet
4. Confirm booking (if fully covered or wallet paid; else Pending for card webhook)
5. Enqueue FBR invoice if tax > 0

**In Supabase:**
```typescript
// supabase/functions/bookings.ts
export async function createBooking(req: CreateBookingRequest) {
  const { data: { user } } = await supabase.auth.getUser();
  
  // 1. Calculate price
  const price = await getPriceAsync(req.bookableKind, req.bookableId, req.startTime, req.endTime);
  
  // 2. Apply package if specified
  let finalPrice = price;
  if (req.memberPackageId) {
    finalPrice = await packageService.redeemAsync(req.memberPackageId, user.id, price);
  }
  
  // 3. Calculate tax
  const tax = await taxService.calculateAsync(req.branchId, finalPrice);
  
  // 4. Insert booking (throws unique index error on conflict → 409 Conflict)
  const { data: booking, error } = await supabase
    .from('bookings')
    .insert({
      court_id: req.courtId,
      room_id: req.roomId,
      seat_id: req.seatId,
      member_id: user.id,
      start_time: req.startTime,
      end_time: req.endTime,
      price: finalPrice,
      tax_amount: tax.amount,
      total: tax.total,
      status: req.paymentMethod === 'Wallet' ? 'Confirmed' : 'Pending'
    })
    .select()
    .single();
  
  if (error?.code === '23505') throw new ConflictError('Slot already booked');
  if (error) throw error;
  
  // 5. Wallet debit (if applicable)
  if (req.paymentMethod === 'Wallet') {
    await walletService.debitAsync(user.id, tax.total, 'BookingPayment', booking.id);
  }
  
  // 6. Enqueue FBR invoice
  if (tax.amount > 0 && booking.status === 'Confirmed') {
    await fbrService.enqueueAsync(booking.id);
  }
  
  return booking;
}
```

### Double-Booking Prevention
**Unchanged:** Filtered unique indexes on `(court_id, start_time)`, `(room_id, start_time)`, `(seat_id, start_time)`
where `status IN ('Pending', 'Confirmed')`. PostgreSQL throws a unique-constraint violation; your handler converts
it to a 409 Conflict response.

### Wallet Concurrency
**Unchanged:** Row-level locking via `SELECT ... FOR UPDATE` in PostgreSQL (inside a transaction), or Supabase's
built-in concurrency handling. The logic is identical: check balance, deduct, update balance — all in one atomic
transaction.

### Tax & FBR Integration
**Unchanged:** `TaxService.CalculateAsync` logic is identical. When `branch.tax_enabled = true`, compute tax on the
final price and enqueue `FbrInvoicingService` (async background job, not on the request path).

---

## Cost Comparison

| Item | ASP.NET (Azure) | Supabase |
|------|---|---|
| **Database** | Azure SQL Managed Instance (~$200–500/month) | Supabase PostgreSQL ($25–150/month) |
| **Compute** | App Service (~$50–200/month) | Supabase Edge Functions (pay-per-use, often <$10/month for small apps) |
| **Auth** | Custom or Azure AD ($0–50/month) | Supabase Auth (included, $0/month) |
| **Total** | $300–750/month | $25–200/month |

Supabase is typically **60–80% cheaper** for small to mid-size apps and scales to enterprise pricing at scale.

---

## Next Steps

1. **Create** `supabase/migrations/001_initial_schema.sql` with all schema from Section 2
2. **Implement** Edge Functions in TypeScript (see sample above)
3. **Test** locally with `supabase start` and `supabase functions serve`
4. **Deploy** to production: `supabase functions deploy`
5. **Point frontend** at your Supabase URL
6. **Monitor** via Supabase dashboard (Logs, Metrics, RLS enforcement)

The business logic (pricing, packages, wallet, tax, notifications) is **identical** — only the infrastructure changes.

