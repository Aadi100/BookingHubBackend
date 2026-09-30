# Booking Hub Backend — Documentation Index

## 📑 Complete Documentation Set

Your Booking Hub backend has been completely updated from **ASP.NET Core + SQL Server** to **Supabase + PostgreSQL + Edge Functions (TypeScript)**.

### Files Created/Updated

| File | Size | Purpose |
|------|------|---------|
| **[README.md](./README.md)** | 9 KB | Overview, architecture, quick start, FAQ |
| **[BACKEND_SPEC.md](./BACKEND_SPEC.md)** | 99 KB | **Master spec** — full design doc, schema, API endpoints, business rules |
| **[SUPABASE_MIGRATION.md](./SUPABASE_MIGRATION.md)** | 10 KB | ASP.NET → Supabase migration guide, cost comparison |
| **[SUPABASE_QUICK_START.md](./SUPABASE_QUICK_START.md)** | 11 KB | Step-by-step setup, local dev, first Edge Function |
| **[EDGE_FUNCTIONS_TEMPLATE.md](./EDGE_FUNCTIONS_TEMPLATE.md)** | 20 KB | Reusable TypeScript patterns for all Edge Functions |

---

## 🎯 Where to Start

### 1️⃣ If you're new to Supabase:
→ Start with **[README.md](./README.md)** (5 min read)
→ Then follow **[SUPABASE_QUICK_START.md](./SUPABASE_QUICK_START.md)** (10 min to set up)

### 2️⃣ If you need to understand the complete design:
→ Read **[BACKEND_SPEC.md](./BACKEND_SPEC.md)** (1 hour) — all business logic, database schema, API endpoints

### 3️⃣ If you're migrating from ASP.NET:
→ Read **[SUPABASE_MIGRATION.md](./SUPABASE_MIGRATION.md)** (15 min) — see what changed, cost savings

### 4️⃣ If you're building Edge Functions:
→ Use **[EDGE_FUNCTIONS_TEMPLATE.md](./EDGE_FUNCTIONS_TEMPLATE.md)** (reference as you code) — copy/paste patterns for auth, bookings, payments, etc.

---

## 🗂️ Documentation Sections

### BACKEND_SPEC.md (Master Reference)

```
Section 1: Project Layout
  → Directory structure for Supabase

Section 2: PostgreSQL Schema (SQL)
  → All 20+ tables with indexes, constraints, RLS policies
  → Keyword: "booking", "court", "room", "package", "payment", "wallet"

Section 3: Authentication (Supabase Auth)
  → JWT tokens, social login, password reset
  → No custom auth code needed

Section 4: Authorization (RLS)
  → Row-Level Security policies
  → Member/Staff/SuperAdmin roles

Section 5: API Endpoints (Edge Functions)
  → REST endpoints for all resources
  → POST /bookings, GET /availability, etc.
  → Booking creation logic with tax, wallet, packages
  → Payment processing (Stripe, JazzCash, EasyPaisa, PayFast)
  → Wallet ledgers
  → Reporting

Section 6: Business Rules
  → Soft-delete only (no hard deletes)
  → Double-booking prevention
  → Wallet concurrency control
  → Tax calculation (FBR integration)
  → Package redemption logic
  → Refund policies
  → Localization (i18n)

Section 7: Background Jobs
  → Abandoned booking cleanup
  → No-show detection
  → Notification dispatch (Resend, WhatsApp)
  → FBR tax filing

Section 8: Local vs. Production
  → Docker PostgreSQL locally
  → Azure/managed SQL Server in production
  → Migration strategy

Section 9: Frontend Integration
  → How React frontend calls the APIs
  → Service layer pattern
```

### README.md (Quick Overview)

- 🚀 5-minute quick start
- 🏗️ Architecture diagram
- 💰 Cost comparison (Supabase vs ASP.NET)
- 📱 Frontend integration guide
- 🛠️ Common tasks (add sport type, enable tax, etc.)
- 🧪 Testing strategies

### SUPABASE_MIGRATION.md (Migration Guide)

- What changed (architecture, database, auth)
- Key changes per section of BACKEND_SPEC.md
- Migration checklist (7 steps)
- Supabase CLI quick start
- Cost breakdown

### SUPABASE_QUICK_START.md (Setup Guide)

1. Create Supabase project
2. Create database schema (SQL editor)
3. Initialize Supabase CLI + local dev
4. Create first Edge Function (bookings example)
5. Test locally (curl)
6. Deploy to production

### EDGE_FUNCTIONS_TEMPLATE.md (Code Patterns)

- **Base pattern** — CORS, auth, error handling (copy-paste template)
- **Auth function** — Member registration, staff creation
- **Availability function** — Slot calculation
- **Bookings function** — Create booking with double-booking prevention, tax, wallet
- **Error handling** — Standard response format
- **Testing locally** — curl examples
- **Deployment checklist** — Security, error handling

---

## 🔍 How to Find Things

### "How do I create a booking?"
→ BACKEND_SPEC.md Section 5 "Bookings" + EDGE_FUNCTIONS_TEMPLATE.md Section 4

### "What's the database schema?"
→ BACKEND_SPEC.md Section 2 (all SQL)

### "How does the wallet work?"
→ BACKEND_SPEC.md Section 6 "Wallet" + Section 5 "Wallet endpoints"

### "How do I set up Supabase locally?"
→ SUPABASE_QUICK_START.md Section 1-2

### "How do I prevent double-booking?"
→ BACKEND_SPEC.md Section 2 "Double-booking prevention" + EDGE_FUNCTIONS_TEMPLATE.md Section 4 error handling

### "How does tax work?"
→ BACKEND_SPEC.md Section 6 "Tax (FBR)" + Section 5 "TaxService"

### "Where do I implement payment processing?"
→ BACKEND_SPEC.md Section 5 "Payments — multi-gateway" + EDGE_FUNCTIONS_TEMPLATE.md Section 5

### "What are the API endpoints?"
→ BACKEND_SPEC.md Section 5 (full list) + README.md "Architecture"

### "How do I test Edge Functions?"
→ SUPABASE_QUICK_START.md Section 8 + EDGE_FUNCTIONS_TEMPLATE.md Section 5

---

## 💡 Key Concepts (Quick Reference)

| Concept | Where | What |
|---------|-------|------|
| **Double-booking** | BACKEND_SPEC.md §2, EDGE_FUNCTIONS_TEMPLATE.md §4 | Unique index on (court_id, start_time) prevents slots booked twice |
| **Wallet ledgers** | BACKEND_SPEC.md §2, §6 | Two tables (`wallet_credits`, `wallet_debits`) instead of signed amounts |
| **Tax** | BACKEND_SPEC.md §5, §6 | Per-branch config; off by default; FBR invoicing async |
| **Packages** | BACKEND_SPEC.md §6 | Four types: FixedSessions, BundleHours, UnlimitedMonthly, DiscountPercent |
| **RLS** | BACKEND_SPEC.md §2, §4 | PostgreSQL policies enforce auth (members see own data, staff see their org/branch) |
| **Soft-delete** | BACKEND_SPEC.md §6 | Nothing ever hard-deleted; `Status = 'suspended'` instead |
| **Notifications** | BACKEND_SPEC.md §7 | Async job; channels: email (Resend), WhatsApp (Meta); templated per language |
| **Payment providers** | BACKEND_SPEC.md §5 | Stripe, JazzCash, EasyPaisa, PayFast; dynamic per-branch config (no hardcoding) |
| **Refunds** | BACKEND_SPEC.md §6 | Tiered by hours until start; computed from refund policy, not hardcoded |

---

## 📋 Implementation Checklist

Use this to track progress as you build:

### Phase 1: Database & Auth
- [ ] Create Supabase project
- [ ] Run all SQL from BACKEND_SPEC.md §2
- [ ] Verify all tables created
- [ ] Configure auth providers (Email, Google, Facebook)
- [ ] Test member registration flow

### Phase 2: Core Edge Functions
- [ ] Implement `auth/register` — member signup + wallet creation
- [ ] Implement `auth/staff/create` — admin staff creation
- [ ] Implement `courts/` CRUD — list, create, update courts
- [ ] Implement `rooms/` CRUD — list, create, update rooms
- [ ] Implement `availability/` — slot calculation
- [ ] Implement `bookings/` POST — create booking (with double-booking check, tax, wallet)
- [ ] Implement `bookings/` GET — list user's bookings
- [ ] Implement `bookings/{id}/cancel` — cancel with refund logic

### Phase 3: Payments & Wallet
- [ ] Implement `payments/intent` — payment intent creation
- [ ] Implement `payments/callback/*` — Stripe/JazzCash/EasyPaisa/PayFast webhooks
- [ ] Implement payment gateway providers (Stripe minimum)
- [ ] Implement `wallet/` GET — balance
- [ ] Implement `wallet/recharge` — top up wallet
- [ ] Implement `wallet/credits` — view credit history
- [ ] Implement `wallet/debits` — view debit history

### Phase 4: Packages & Notifications
- [ ] Implement `packages/` CRUD
- [ ] Implement `packages/{id}/purchase` — package purchase with payment
- [ ] Implement `members/{id}/packages` — list member's packages
- [ ] Implement Resend email sender (booking confirmed, password reset)
- [ ] Implement Meta WhatsApp sender (booking confirmed, reminder)
- [ ] Implement `notifications/` GET — list notifications
- [ ] Implement `notifications/{id}/mark-read`

### Phase 5: Background Jobs & Admin
- [ ] AbandonedBookingCleanupJob (Pending bookings timeout)
- [ ] NoShowDetectionJob (mark past bookings as NoShow)
- [ ] NotificationDispatchJob (send pending notifications)
- [ ] FbrInvoicingJob (file tax invoices)
- [ ] RefundReconciliationJob (reconcile refund status)
- [ ] Staff/admin endpoints (users, organizations, branches)
- [ ] Reporting endpoints (revenue, utilization, bookings summary)

### Phase 6: Frontend Integration
- [ ] Point frontend `src/services/*` to Supabase APIs
- [ ] Update Supabase client initialization
- [ ] Test end-to-end: register → create booking → make payment → get confirmation

### Phase 7: Production
- [ ] Set environment variables (Supabase URL, API keys)
- [ ] Deploy Edge Functions (`supabase functions deploy`)
- [ ] Set up HTTPS + custom domain
- [ ] Configure payment provider live credentials
- [ ] Set up monitoring & alerts
- [ ] Create runbooks for common issues

---

## 🚨 Important Reminders

1. **Never hardcode prices, tax rates, or config** → Always read from database rows
2. **Always validate input** → Don't trust client-sent courtId/branchId; verify user access
3. **Always use transactions** → Booking + payment + wallet must be atomic
4. **Always encrypt sensitive data** → Payment gateway credentials in `credentials_json`
5. **Always test double-booking** → Try concurrent booking attempts on same slot
6. **Always log errors** → Use `console.error()` in Edge Functions; check Supabase logs
7. **Never commit `.env` files** → Use Supabase secrets/environment variables
8. **Never trust RLS alone** → Also validate in Edge Function handlers (defense in depth)

---

## 📞 Need Help?

- **Supabase Docs:** https://supabase.com/docs
- **Edge Functions Guide:** https://supabase.com/docs/guides/functions
- **Deno Documentation:** https://docs.deno.com
- **This Spec:** Read BACKEND_SPEC.md in detail

---

## ✅ Status

**Updated:** 2026-09-30  
**Author:** Claude (Sonnet 5.5)  
**Status:** ✅ Complete — Ready to implement

All documentation is now aligned for **Supabase** (PostgreSQL + Edge Functions). The business logic (booking, payments, wallet, tax) is **unchanged** from the original ASP.NET spec — only the infrastructure has shifted.

**Next step:** Follow [SUPABASE_QUICK_START.md](./SUPABASE_QUICK_START.md) to set up your first project! 🚀

