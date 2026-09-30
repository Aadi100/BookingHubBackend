# Booking Hub Backend — Supabase

A court/zone booking platform backend built on **Supabase** (PostgreSQL + Edge Functions).

## 📋 Documentation

### Core Specification
- **[BACKEND_SPEC.md](./BACKEND_SPEC.md)** — Complete backend design, database schema, API endpoints, business rules
  - Section 1: Architecture overview
  - Section 2: PostgreSQL schema (tables, indexes, RLS policies)
  - Section 3: Authentication (Supabase Auth)
  - Section 4: Authorization (RLS, roles)
  - Section 5: API endpoints (Edge Functions)
  - Section 6: Business rules (booking, wallet, tax, etc.)
  - Section 7: Background jobs
  - Section 8: Local vs. production checklist
  - Section 9: Frontend integration notes

### Migration Guide
- **[SUPABASE_MIGRATION.md](./SUPABASE_MIGRATION.md)** — Step-by-step migration from ASP.NET to Supabase
  - What changed (architecture, database, auth, etc.)
  - Cost comparison
  - Migration checklist

### Quick Start
- **[SUPABASE_QUICK_START.md](./SUPABASE_QUICK_START.md)** — Get started in 10 minutes
  - Project setup
  - Local development
  - First Edge Function
  - Testing

### Edge Functions Templates
- **[EDGE_FUNCTIONS_TEMPLATE.md](./EDGE_FUNCTIONS_TEMPLATE.md)** — Reusable patterns for all Edge Functions
  - Base pattern (CORS, auth, routing)
  - Auth (registration, staff creation)
  - Availability calculation
  - Bookings (create, list)
  - Error handling
  - Testing & deployment

---

## 🚀 Quick Start (5 min)

### 1. Create Supabase Project
```bash
# Go to supabase.com → create project
# Note your Project URL and API Key
```

### 2. Clone Schema
Copy all SQL from [BACKEND_SPEC.md Section 2](./BACKEND_SPEC.md#2-postgresql-schema-supabase) into Supabase SQL Editor → Run

### 3. Create First Edge Function
```bash
npm install -g supabase
supabase link --project-ref <your-project-ref>
supabase functions new bookings
# Edit supabase/functions/bookings/index.ts (see EDGE_FUNCTIONS_TEMPLATE.md)
supabase functions serve
```

### 4. Test
```bash
curl -X GET http://localhost:54321/functions/v1/bookings \
  -H "Authorization: Bearer <jwt-token>"
```

---

## 🏗️ Architecture

### Database (PostgreSQL)
- **Organizations** → Branches
- **Branches** → Courts, Rooms, Packages
- **Courts/Rooms** → Schedules, Exceptions
- **Members** → Wallets, Bookings, Packages
- **Bookings** → Payments, Notifications
- **Staff** → Profiles, Roles

### APIs (Edge Functions)
- `POST   /auth/register` — Member registration
- `POST   /auth/login` — JWT login
- `GET    /courts/{id}/availability` — Slot availability
- `POST   /bookings` — Create booking
- `PATCH  /bookings/{id}/cancel` — Cancel booking
- `GET    /members/{id}/wallet` — Wallet balance
- `POST   /payments/{id}/intent` — Payment intent
- (see BACKEND_SPEC.md Section 5 for full list)

### Auth
- Supabase Auth (managed JWT)
- Row-Level Security (RLS) for authorization
- Social login (Google, Facebook, Microsoft)

---

## 💰 Cost

| Service | Cost | Notes |
|---------|------|-------|
| Supabase PostgreSQL | ~$25–150/mo | Includes 500MB free, $4/100GB |
| Edge Functions | ~$0–50/mo | Pay-per-use, often <$5 for small apps |
| Email (Resend) | ~$20–50/mo | For confirmations, password reset |
| WhatsApp (Meta) | ~$0–100/mo | Message template fees |
| **Total** | **~$50–350/mo** | 60–80% cheaper than ASP.NET + Azure |

---

## 📚 Key Concepts

### Double-Booking Prevention
Filtered unique indexes on `(court_id|room_id|seat_id, start_time)` where status is `Pending` or `Confirmed`.
PostgreSQL enforces this; duplicate booking attempts get a 409 Conflict error.

### Wallet & Ledgers
Two append-only tables (`wallet_credits`, `wallet_debits`) instead of signed amounts. Enables:
- Clear audit trail
- Accurate tax/FBR reporting
- No risk of a credit written to the debit column

### Tax (FBR)
- Per-branch config: `branch.tax_enabled` flag
- When enabled, every booking/package includes tax in the total
- FBR invoicing done asynchronously (doesn't block booking)
- Tax-inclusive refunds (member refunded what they paid, not just pre-tax amount)

### Packages
Four types:
- `FixedSessions` — book N sessions, fully covers the booking (price = 0)
- `BundleHours` — book N hours, fully covers the booking
- `UnlimitedMonthly` — book unlimited times until expiry
- `DiscountPercent` — X% off, still requires payment for the discounted amount

### Notifications
- Sent asynchronously (don't block booking)
- Channels: email (Resend), SMS, WhatsApp (Meta), push
- Templated per language (i18n)
- Delivery tracking via webhooks

---

## 🔐 Security

### Row-Level Security (RLS)
Every table has RLS policies enforcing:
- Members see only their own data
- Staff see data in their organization/branch
- SuperAdmin sees everything

### Authentication
- Supabase Auth handles passwords, tokens, social login
- JWTs verified on every Edge Function call
- Rate limiting built-in (15 req/min on auth endpoints)

### Encryption
- Payment gateway credentials stored encrypted in `branch_payment_providers.credentials_json`
- Use Supabase Vault or application-layer encryption (KMS)
- Database backups encrypted at rest

---

## 🛠️ Development Workflow

```bash
# 1. Start local Supabase
supabase start

# 2. Run migrations
supabase db push

# 3. Develop Edge Functions
supabase functions serve

# 4. Test locally
curl ... -H "Authorization: Bearer <jwt>"

# 5. Deploy to production
supabase functions deploy
supabase db push --dry-run  # Review changes
supabase db push            # Apply to production
```

---

## 📖 Common Tasks

### Add a New Booking Type (e.g., Tennis → Pickleball)
1. Create a new `Court` row with `sport_type = 'pickleball'`
2. Insert `CourtSchedule` rows for the new court
3. Done! No code change.

### Enable Tax for a Branch
1. Set `branch.tax_enabled = true` and `branch.tax_rate_percent = 17` (or actual rate)
2. Set `branch.fbr_pos_registration_number` to the POS ID
3. Done! Next bookings auto-include tax.

### Add a New Payment Provider
1. Create a row in `branch_payment_providers` with the provider type and encrypted credentials
2. Implement the `IPaymentGatewayProvider` interface in `supabase/functions/payments/providers/`
3. Done! Branches can enable it via a PATCH.

### Change Booking Refund Policy
1. Update the `CancellationPolicyService` logic (or database-driven config)
2. No database schema change needed
3. Done!

---

## 🧪 Testing

### Unit Tests (Deno)
```typescript
// test.ts
import { assertEquals } from "https://deno.land/std@0.208.0/testing/asserts.ts";

Deno.test("calculatePrice", () => {
  const price = calculatePrice(5000, 2); // hourly_rate, duration_hours
  assertEquals(price, 10000);
});
```

Run: `deno test`

### Integration Tests (Edge Functions)
```bash
# With Supabase running
supabase functions serve

# Test endpoint
curl -X POST http://localhost:54321/functions/v1/bookings \
  -H "Authorization: Bearer <token>" \
  -d '{ "court_id": "...", "start_time": "...", "end_time": "..." }'
```

### Manual Testing (Postman / curl)
See SUPABASE_QUICK_START.md Section 9.

---

## 📱 Frontend Integration

The React frontend's `src/services/*` mock functions map 1:1 to these API endpoints.

**Before (mock):**
```typescript
// src/services/bookingService.ts
export async function createBooking(req: CreateBookingRequest) {
  return { id: "uuid", status: "Confirmed", ... };
}
```

**After (real):**
```typescript
export async function createBooking(req: CreateBookingRequest) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/bookings`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(req)
    }
  );
  return await response.json();
}
```

No component changes needed.

---

## 🚨 Known Limitations & Next Steps

### Limitations (by design)
- No variable-length bookings yet (all bookings are fixed-length slots)
- Email templates are inline (can be moved to a template engine)
- Refund reconciliation for redirect-based payments (JazzCash/EasyPaisa) is manual (should add `RefundReconciliationJob`)

### Next Steps (in order of priority)
1. Implement all Edge Functions from EDGE_FUNCTIONS_TEMPLATE.md
2. Set up Resend for email notifications
3. Set up Meta WhatsApp Business Cloud API
4. Implement payment gateway integrations (Stripe, JazzCash, EasyPaisa, PayFast)
5. Add background jobs (Supabase scheduled functions or external job runner)
6. Add FBR tax filing integration
7. Add real-time subscriptions (Supabase Realtime)
8. Add file storage (Supabase Storage for receipts/images)

---

## 📞 Support

- **Supabase Docs:** https://supabase.com/docs
- **Edge Functions:** https://supabase.com/docs/guides/functions
- **Deno Docs:** https://docs.deno.com
- **This Backend Spec:** See BACKEND_SPEC.md

---

## 📝 License

Proprietary — Booking Hub Platform

---

## 👤 Author

Built with [Claude](https://claude.ai) + [Supabase](https://supabase.com)

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>

