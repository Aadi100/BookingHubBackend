# Booking Hub Backend Specification (Supabase / PostgreSQL)

This document is the backend design for the Booking Hub court/zone booking platform,
targeting **Supabase** (PostgreSQL database + Edge Functions for serverless APIs). Build it as a
**serverless backend** that integrates with your React frontend over REST/GraphQL APIs.
The frontend already isolates all data access behind a service layer (`src/services/*`),
so pointing it at real endpoints means editing only those files — component code does not change.

## Suggested project layout

```
supabase/
 ├─ migrations/           PostgreSQL migration files (numbered: 001_initial_schema.sql, etc.)
 ├─ functions/            TypeScript Edge Functions (one file per resource endpoint: bookings.ts, courts.ts, etc.)
 ├─ seed.sql              (optional) seed data for development
 └─ config.toml           Supabase local development config
```

For a JSON-only backend serving a separate React app via Supabase:
- **Database:** PostgreSQL with Row-Level Security (RLS) policies for authorization
- **APIs:** Edge Functions (Deno/TypeScript runtime) or auto-generated REST/GraphQL via PostgREST
- **Auth:** Supabase Auth (JWT tokens, built-in support for social login)
- **Real-time:** Supabase Realtime subscriptions for live updates (optional)
- **Storage:** Supabase Storage for file uploads (receipts, images — optional)

Keep the business logic in Edge Functions or stored procedures, never in the React frontend,
so booking-conflict detection and wallet logic stay server-controlled and unit-testable.

### Configuration philosophy: the backend is data-driven, not hardcoded

Anything that legitimately varies per organization/branch is a **database row an admin can
edit through the API**, never a compile-time constant or an `appsettings.json` value that
requires a redeploy to change. This spec applies that consistently:

- **Payment gateways** — which providers a branch accepts, their credentials, and the default,
  live in `BranchPaymentProvider` rows (section 5, "Payments — multi-gateway"), not a `switch`
  statement or config-file provider list. Enabling PayFast for one branch and Stripe-only for
  another is an admin `PATCH`, not a code change.
- **Tax** — `Branch.TaxEnabled`/`TaxRatePercent` (section 6, "Tax (FBR)") — on for branches that
  collect it, off for branches that don't, per-branch rate, no hardcoded percentage anywhere in
  `TaxService`.
- **Cancellation/refund policy** — tiered refund percentages resolve court/room → branch → org
  (section 6), not one global rule.
- **Business hours & pricing** — `CourtSchedule`/`RoomSchedule`/`*Exception` rows (section 1),
  never hardcoded in the frontend or the API.
- **Notification channels** — a member's `EmailOptIn`/`WhatsAppOptIn`, and which channel a
  given `Notification.Type` uses, are data, not an if/else chain tied to one hardcoded channel.

The only things that are genuinely constant across the whole system are the ones section 6
explicitly calls out as such (e.g. "nothing is ever hard-deleted," the booking state machine
itself) — those are business invariants, not configuration, and stay in code on purpose.

---

## 1. Core entity model

There are **two different booking shapes** in this business, and they must not be flattened
into one generic "court" concept — they behave differently:

1. **Court venues** (tennis, padel, football, badminton...): the bookable unit is the whole
   court. One party books the entire court for a time range. Always booked as a single unit.
2. **Zone venues** (gaming centers): the bookable unit is a **Room**, and a Room is defined by
   a game type (FIFA, CS2, PS5, pool, etc.) with a fixed number of seats/stations. A Room can
   allow two different booking granularities, configured per room:
   - `WholeRoom` — booked as one block (e.g. a private CS2 5-seat room booked by one group),
     behaves exactly like a Court booking.
   - `PerSeat` — an open zone where individual seats/PCs/consoles are booked independently
     (e.g. a walk-in gaming lounge with 10 PCs; one customer books 1 PC, not the whole room).

Both venue types share the same booking/payment/notification machinery underneath — only the
"what is being reserved" differs (a `CourtId`, a `RoomId`, or a `SeatId`).

```
Organization
  └─ Branch (a physical venue; VenueType = Court | Zone)
       ├─ Court              (court venues only — a whole bookable unit: "Padel Court 2")
       │    └─ CourtSchedule / CourtException  (hours, slot length, pricing, holidays)
       │
       └─ Room               (zone venues only — a game room: "CS2 Room A")
            ├─ GameType, Capacity, BookingMode (WholeRoom | PerSeat)
            ├─ Seat            (only exists if BookingMode = PerSeat, e.g. "PC-04")
            └─ RoomSchedule / RoomException     (hours, slot length, pricing, holidays)

Package        (bundles/subscriptions sold against a Court, a Room, or a whole Branch)
MemberPackage  (a Member's purchased package + remaining balance/expiry)
Booking        (reserves ONE of: CourtId | RoomId (whole room) | SeatId (single seat))
ApplicationUser (ASP.NET Core Identity user — shared table for both staff and members, see section 3)
Member         (customer profile, 1:1 with an ApplicationUser)
  └─ Wallet             (a Member's rechargeable balance — one row per member)
       ├─ WalletCredit  (ledger: recharge / refund / manual-adjustment entries)
       └─ WalletDebit   (ledger: booking-payment / package-purchase / manual-adjustment entries)
StaffProfile   (staff/admin profile, 1:1 with an ApplicationUser) — Role: SuperAdmin, OrgAdmin, BranchManager, Staff, Support
Payment        (linked 1:1 to a Booking, a Package purchase, OR a Wallet recharge)
Notification   (linked to a Member/StaffProfile + a Booking)
```

Members can pay for a booking or a package purchase three ways: a direct card charge, a
Wallet debit, or a Package redemption. The Wallet itself is topped up via a card charge — so a
"recharge" is really just a `Payment` whose proceeds credit the wallet instead of confirming a
booking.

---

## 2. PostgreSQL Schema (Supabase)

```sql
-- Organizations table
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', -- active | inactive
    ntn_number TEXT, -- FBR National Tax Number
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row-Level Security (RLS) policies
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_admin_access ON organizations 
    FOR ALL USING (auth.uid() IN (
        SELECT id FROM staff_profiles WHERE organization_id = organizations.id
    ));

-- Branches table
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    name TEXT NOT NULL,
    venue_type TEXT NOT NULL CHECK (venue_type IN ('Court', 'Zone')),
    location TEXT,
    description TEXT,
    amenities TEXT[] DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active', -- active | maintenance | inactive

    -- Tax config (OFF by default)
    tax_enabled BOOLEAN DEFAULT FALSE,
    tax_rate_percent NUMERIC(5,2) DEFAULT 0,
    fbr_pos_registration_number TEXT,

    -- Operational config (database rows, not hardcoded)
    default_currency TEXT DEFAULT 'PKR',
    notification_language TEXT DEFAULT 'en',
    card_payment_timeout_minutes INT DEFAULT 10,
    no_show_grace_minutes INT DEFAULT 15,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for org lookups
CREATE INDEX idx_branches_organization_id ON branches(organization_id);

-- RLS: BranchManager and OrgAdmin can access their branches
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_access ON branches
    FOR ALL USING (
        auth.uid() IN (SELECT id FROM staff_profiles WHERE branch_id = branches.id)
        OR auth.uid() IN (SELECT id FROM staff_profiles WHERE organization_id = branches.organization_id)
    );

-- Courts table (court venues: booked as a whole unit)
CREATE TABLE courts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    name TEXT NOT NULL,
    sport_type TEXT NOT NULL, -- tennis | padel | football | ...
    capacity INT DEFAULT 1,
    hourly_rate NUMERIC(10,2) NOT NULL,
    amenities TEXT[] DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active', -- active | inactive
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_courts_branch_id ON courts(branch_id);

-- Court schedules (business hours + slot configuration)
CREATE TABLE court_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    court_id UUID NOT NULL REFERENCES courts(id),
    day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday, 6=Saturday
    open_time TIME NOT NULL,
    close_time TIME NOT NULL,
    slot_minutes INT DEFAULT 60,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_court_schedules_court_id ON court_schedules(court_id);

-- Court exceptions (holidays, special hours, surge pricing)
CREATE TABLE court_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    court_id UUID NOT NULL REFERENCES courts(id),
    date DATE NOT NULL,
    is_closed BOOLEAN DEFAULT FALSE,
    open_time TIME,
    close_time TIME,
    price_override NUMERIC(10,2), -- replaces hourly rate for this date
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_court_exceptions_court_id ON courts(court_id);
CREATE INDEX idx_court_exceptions_date ON court_exceptions(date);

-- Rooms table (zone venues: game/activity rooms)
CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    name TEXT NOT NULL, -- "CS2 Room A"
    game_type TEXT NOT NULL, -- fifa | cs2 | ps5 | pc_open | ...
    capacity INT NOT NULL,
    booking_mode TEXT NOT NULL CHECK (booking_mode IN ('WholeRoom', 'PerSeat')),
    hourly_rate NUMERIC(10,2) NOT NULL, -- price when booked as whole
    amenities TEXT[] DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active', -- active | inactive
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rooms_branch_id ON rooms(branch_id);

-- Seats table (only used when room.booking_mode = 'PerSeat')
CREATE TABLE seats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id),
    label TEXT NOT NULL, -- "PC-04"
    hourly_rate NUMERIC(10,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_seats_room_id ON seats(room_id);

-- Room schedules (business hours + slot configuration)
CREATE TABLE room_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id),
    day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    open_time TIME NOT NULL,
    close_time TIME NOT NULL,
    slot_minutes INT DEFAULT 60,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_room_schedules_room_id ON room_schedules(room_id);

-- Room exceptions (holidays, special hours, surge pricing)
CREATE TABLE room_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id),
    date DATE NOT NULL,
    is_closed BOOLEAN DEFAULT FALSE,
    open_time TIME,
    close_time TIME,
    price_override NUMERIC(10,2),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_room_exceptions_room_id ON room_exceptions(room_id);
CREATE INDEX idx_room_exceptions_date ON room_exceptions(date);

-- Packages table (bundles/subscriptions for court, room, seat, or branch)
CREATE TABLE packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    scope TEXT NOT NULL CHECK (scope IN ('Court', 'Room', 'Seat', 'Branch')),
    scope_id UUID, -- Court/Room/Seat id (null if scope = 'Branch')
    name TEXT NOT NULL,
    package_type TEXT NOT NULL CHECK (package_type IN ('FixedSessions', 'BundleHours', 'UnlimitedMonthly', 'DiscountPercent')),
    sessions_included INT, -- for FixedSessions
    hours_included NUMERIC(10,2), -- for BundleHours
    discount_percent NUMERIC(5,2), -- for DiscountPercent
    valid_days INT NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_packages_branch_id ON packages(branch_id);
CREATE INDEX idx_packages_scope_id ON packages(scope_id);

-- Members table (customers — 1:1 with auth.users via member.id = auth_users.id)
CREATE TABLE members (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    status TEXT NOT NULL DEFAULT 'active', -- active | banned
    preferred_language TEXT DEFAULT 'en',
    email_opt_in BOOLEAN DEFAULT TRUE,
    whatsapp_opt_in BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Wallet table (member's rechargeable balance — one row per member)
CREATE TABLE wallets (
    member_id UUID PRIMARY KEY REFERENCES members(id),
    balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
    currency TEXT NOT NULL DEFAULT 'PKR',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Member packages (purchased package instances + remaining balance)
CREATE TABLE member_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES members(id),
    package_id UUID NOT NULL REFERENCES packages(id),
    sessions_remaining INT,
    hours_remaining NUMERIC(10,2),
    purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', -- active | expired | exhausted
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_member_packages_member_id ON member_packages(member_id);
CREATE INDEX idx_member_packages_package_id ON member_packages(package_id);

-- Wallet credits (append-only ledger: recharges, refunds, adjustments)
CREATE TABLE wallet_credits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES members(id),
    reason TEXT NOT NULL CHECK (reason IN ('Recharge', 'Refund', 'ManualAdjustment')),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0), -- always positive
    balance_after NUMERIC(12,2) NOT NULL,
    reference TEXT NOT NULL,
    payment_id UUID, -- the recharge Payment that funded this
    booking_id UUID, -- the cancelled booking being refunded
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallet_credits_member_id ON wallet_credits(member_id);
CREATE INDEX idx_wallet_credits_created_at ON wallet_credits(created_at);

-- Wallet debits (append-only ledger: booking payments, package purchases, adjustments)
CREATE TABLE wallet_debits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES members(id),
    reason TEXT NOT NULL CHECK (reason IN ('BookingPayment', 'PackagePurchase', 'ManualAdjustment')),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0), -- always positive
    balance_after NUMERIC(12,2) NOT NULL,
    reference TEXT NOT NULL,
    booking_id UUID, -- the booking this debit paid for
    member_package_id UUID, -- the package purchase this debit paid for
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallet_debits_member_id ON wallet_debits(member_id);
CREATE INDEX idx_wallet_debits_created_at ON wallet_debits(created_at);

-- Staff profiles (admins — 1:1 with auth.users via staff_profile.id = auth_users.id)
CREATE TABLE staff_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('SuperAdmin', 'OrgAdmin', 'BranchManager', 'Staff', 'Support')),
    organization_id UUID REFERENCES organizations(id), -- null for SuperAdmin
    branch_id UUID REFERENCES branches(id), -- null unless scoped to one branch
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_staff_profiles_organization_id ON staff_profiles(organization_id);
CREATE INDEX idx_staff_profiles_branch_id ON staff_profiles(branch_id);

-- RLS: Members see only their own profile
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
CREATE POLICY members_self_access ON members
    FOR ALL USING (id = auth.uid());

-- RLS: Staff see members in their org/branch
ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_self_access ON staff_profiles
    FOR ALL USING (id = auth.uid());

-- Bookings table (the core transactional record)
-- CONSTRAINT: exactly ONE of court_id / room_id / seat_id must be non-null
CREATE TABLE bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    court_id UUID REFERENCES courts(id),
    room_id UUID REFERENCES rooms(id),
    seat_id UUID REFERENCES seats(id),
    member_id UUID NOT NULL REFERENCES members(id),
    member_package_id UUID REFERENCES member_packages(id),
    payment_method TEXT NOT NULL DEFAULT 'Card' CHECK (payment_method IN ('Card', 'Wallet', 'Package')),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Confirmed', 'Completed', 'Cancelled', 'NoShow')),
    
    -- Price & tax breakdown (tax is 0 when branch.tax_enabled = false)
    price NUMERIC(10,2) NOT NULL DEFAULT 0, -- subtotal BEFORE tax
    tax_rate_percent NUMERIC(5,2) DEFAULT 0,
    tax_amount NUMERIC(10,2) DEFAULT 0,
    total NUMERIC(10,2) NOT NULL, -- = price + tax_amount
    currency TEXT NOT NULL DEFAULT 'PKR',
    
    -- FBR invoicing (tax-related, null when no tax)
    fbr_invoice_number TEXT,
    fbr_qr_code TEXT,
    
    created_by_staff_id UUID REFERENCES staff_profiles(id),
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraint: exactly one of court_id, room_id, seat_id
    CONSTRAINT exactly_one_bookable CHECK (
        (CASE WHEN court_id IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN room_id IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN seat_id IS NOT NULL THEN 1 ELSE 0 END) = 1
    )
);

CREATE INDEX idx_bookings_member_id ON bookings(member_id);
CREATE INDEX idx_bookings_court_id ON bookings(court_id) WHERE court_id IS NOT NULL;
CREATE INDEX idx_bookings_room_id ON bookings(room_id) WHERE room_id IS NOT NULL;
CREATE INDEX idx_bookings_seat_id ON bookings(seat_id) WHERE seat_id IS NOT NULL;
CREATE INDEX idx_bookings_start_time ON bookings(start_time);
CREATE INDEX idx_bookings_status ON bookings(status);

-- Double-booking prevention: unique index on (resource_id, start_time) for active bookings
CREATE UNIQUE INDEX ux_booking_court_slot ON bookings(court_id, start_time)
    WHERE court_id IS NOT NULL AND status IN ('Pending', 'Confirmed');
CREATE UNIQUE INDEX ux_booking_room_slot ON bookings(room_id, start_time)
    WHERE room_id IS NOT NULL AND status IN ('Pending', 'Confirmed');
CREATE UNIQUE INDEX ux_booking_seat_slot ON bookings(seat_id, start_time)
    WHERE seat_id IS NOT NULL AND status IN ('Pending', 'Confirmed');

-- RLS: Members see only their own bookings
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY bookings_member_access ON bookings
    FOR ALL USING (member_id = auth.uid());

-- Payments table
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID REFERENCES bookings(id),
    member_package_id UUID REFERENCES member_packages(id),
    purpose TEXT NOT NULL DEFAULT 'booking' CHECK (purpose IN ('booking', 'package_purchase', 'wallet_recharge')),
    amount NUMERIC(10,2) NOT NULL,
    tax_amount NUMERIC(10,2) DEFAULT 0, -- 0 for wallet_recharge
    currency TEXT NOT NULL DEFAULT 'PKR',
    provider TEXT NOT NULL, -- stripe | jazzcash | easypaisa | payfast | cash | wallet
    provider_ref TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_booking_id ON payments(booking_id);
CREATE INDEX idx_payments_member_package_id ON payments(member_package_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_provider ON payments(provider);

-- Notifications table
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID REFERENCES members(id),
    staff_id UUID REFERENCES staff_profiles(id),
    booking_id UUID REFERENCES bookings(id),
    channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp', 'push')),
    type TEXT NOT NULL, -- booking_confirmed | reminder | cancelled | password_reset | staff_invite | ...
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'delivered')),
    provider_message_id TEXT, -- Resend/WhatsApp/etc message ID for status tracking
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_member_id ON notifications(member_id);
CREATE INDEX idx_notifications_staff_id ON notifications(staff_id);
CREATE INDEX idx_notifications_status ON notifications(status);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);

-- Translations (EAV-shaped: entity-agnostic translatable fields)
-- One row per (entity_type, entity_id, field_name, language_code)
CREATE TABLE translations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL, -- "Branch" | "Court" | "Room" | "Package" | "NotificationTemplate" | ...
    entity_id UUID NOT NULL,
    field_name TEXT NOT NULL, -- "Name" | "Description" | "CancelReasonLabel" | ...
    language_code TEXT NOT NULL, -- "en" | "ur" | ...
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(entity_type, entity_id, field_name, language_code)
);

CREATE INDEX idx_translations_entity ON translations(entity_type, entity_id);
CREATE INDEX idx_translations_language ON translations(language_code);
```

### Database constraints (PostgreSQL)

All constraints are enforced via:
1. **Foreign keys** (defined above in table `REFERENCES` clauses)
2. **CHECK constraints** (Column-level & table-level, defined above)
3. **Unique indexes** (on translations, double-booking prevention, etc.)
4. **Row-Level Security (RLS) policies** (Supabase auth integration)

**Double-booking prevention — the part PostgreSQL's exclusion constraint would handle.**
Because this app only ever books one fixed-length slot at a time (the frontend's slot picker always sends exactly one
`(start, end)` pair matching the resource's configured `SlotMinutes` — never an arbitrary
custom range), you get the same guarantee with a plain **filtered unique index** on
`(court_id, start_time)` / `(room_id, start_time)` / `(seat_id, start_time)`, scoped to active
statuses — defined above in the bookings table section.

This is what actually stops two concurrent requests from double-booking the same slot — not
an app-level "check then insert." Edge Functions / API handlers should catch the
unique-index-violation error these throw on conflict and translate it into a friendly
"this slot was just booked" `409 Conflict` response (see section 5).

### Payment Providers Configuration (Supabase)

```sql
-- Branch payment providers (dynamic per-branch gateway configuration)
CREATE TABLE branch_payment_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    provider_type TEXT NOT NULL CHECK (provider_type IN ('Stripe', 'JazzCash', 'EasyPaisa', 'PayFast', 'Cash', 'Wallet')),
    is_enabled BOOLEAN DEFAULT FALSE,
    is_default BOOLEAN DEFAULT FALSE, -- exactly one enabled provider per branch is default
    credentials_json TEXT NOT NULL DEFAULT '{}', -- encrypted at rest via Supabase Secrets
    currency TEXT DEFAULT 'PKR',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_branch_payment_providers_branch_id ON branch_payment_providers(branch_id);
ALTER TABLE branch_payment_providers ENABLE ROW LEVEL SECURITY;
```

**Credentials encryption note:** Store `credentials_json` encrypted using Supabase Vault or application-layer encryption
via a secure key management service (never plaintext in the database). The Edge Functions decrypt on read.

---

## 3. Authentication (Supabase Auth)

- Use **Supabase Auth** (built-in JWT tokens, managed by Supabase) for both members and staff —
  one shared `auth.users` table in Supabase's managed schema. Members and staff are distinguished
  by which profile table (`members` or `staff_profiles`) has a matching row for that user's `id`.
- **Members (customer site):** register/login through Supabase's `signUpWithPassword` / `signInWithPassword`
  client SDK. On successful registration, create the matching `members` row and `wallets` row in the same
  transaction (use Supabase RLS policies + triggers or an Edge Function to ensure atomic creation).
- **Staff (admin panel):** accounts are created by an existing admin via `POST /api/v1/staff-users`,
  gated to `SuperAdmin`/`OrgAdmin` in an Edge Function. The function invokes `admin.auth.createUser()` to
  create the auth user, then inserts the `staff_profiles` row with `organization_id`/`branch_id` in the
  same Edge Function call (wrapped in a transaction).
- **Tokens:** Supabase Auth auto-issues JWT bearer tokens on login containing `sub` (user id) and
  `user_metadata` (custom claims). Store staff role/organization/branch IDs in `user_metadata` so Edge Functions
  can read them via `auth.jwt()` to enforce authorization (see section 4).
- **Password reset:** Supabase Auth handles email links and password reset flow — no custom code needed,
  just configure the `SITE_URL` environment variable and email template in Supabase dashboard.
- **Rate limiting:** Supabase Auth includes built-in rate limiting on auth endpoints (default 15 requests/min).
  Adjust via environment variables if needed; it's platform-wide (not per-branch), same as ASP.NET.

### Social login (members only)

Members can additionally sign in via Google/Facebook/Microsoft using Supabase's built-in OAuth providers —
no separate identity vendor needed. Staff accounts are admin-created only (section 3 above) and never use social login.

- **Setup (Supabase dashboard):** Enable Google, Facebook, Microsoft OAuth providers with their client IDs/secrets.
  Supabase handles the OAuth flow — your frontend just calls `supabase.auth.signInWithOAuth()`.
- **Client-side (React):**
  ```typescript
  const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google', // or 'facebook', 'microsoft'
      options: { redirectTo: `${window.location.origin}/auth/callback` }
  });
  ```
  Supabase redirects to your callback page with a session fragment (`#access_token=...`). The frontend client SDK
  auto-extracts and validates it, then calls the backend API with the token in the `Authorization: Bearer` header.

- **Edge Function / API handler (`POST /api/v1/auth/callback`):**
  ```typescript
  // Handler receives the JWT from supabase.auth.getSession()
  const { data: { user } } = await supabase.auth.getUser();
  const email = user.email!;

  // Check if member exists; if not, create it
  let member = await db.from('members')
      .select('id')
      .eq('id', user.id)
      .single();

  if (!member) {
      // First time: create member + wallet
      const { error } = await db.from('members').insert({
          id: user.id,
          name: user.user_metadata?.full_name || email,
          email: email,
          preferred_language: 'en'
      });
      if (error) throw error;

      await db.from('wallets').insert({
          member_id: user.id,
          currency: 'PKR'
      });
  }
  // Already exists: no duplicate, no duplicate account created

  // Return JWT to frontend
  return { accessToken: user.session!.access_token };
  ```
  Matching on email prevents duplicates when someone who registered with email/password later signs in with Google
  using the same email — Supabase handles the linking server-side via the user's existing email-based account.

---

## 4. Authorization model

Roles, from broadest to narrowest:

| Role | Scope |
|---|---|
| `SuperAdmin` | Everything, all organizations |
| `OrgAdmin` | Everything within their `OrganizationId` |
| `BranchManager` | Everything within their `BranchId` |
| `Staff` | Bookings + members within their `BranchId`, read-only elsewhere |
| `Support` | Read-only bookings/members across their org, for customer support |

Enforce this with a **resource-based `IAuthorizationHandler`**, not just `[Authorize(Roles=...)]`
attributes — role alone doesn't know *which* organization/branch a resource belongs to.

```csharp
public class BranchScopeRequirement : IAuthorizationRequirement { }

public class BranchScopeHandler : AuthorizationHandler<BranchScopeRequirement, Branch>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context, BranchScopeRequirement requirement, Branch resource)
    {
        var role = context.User.FindFirstValue(ClaimTypes.Role);
        if (role == nameof(StaffRole.SuperAdmin)) { context.Succeed(requirement); return Task.CompletedTask; }

        var orgClaim = context.User.FindFirstValue("organizationId");
        var branchClaim = context.User.FindFirstValue("branchId");

        if (role == nameof(StaffRole.OrgAdmin) && orgClaim == resource.OrganizationId.ToString())
            context.Succeed(requirement);
        else if (branchClaim == resource.Id.ToString())
            context.Succeed(requirement);

        return Task.CompletedTask;
    }
}
```

Call `await _authorizationService.AuthorizeAsync(User, branch, "BranchScope")` inside every
controller action that reads/writes a specific branch (and the same pattern for courts/rooms
scoped through their branch) — **never** trust a `branchId` route parameter without this
check, or a `Staff` user could edit another branch just by changing the URL.

Members only ever access their own rows — enforce with a plain
`if (booking.MemberId != CurrentUserId) return Forbid();` at the top of every member-facing
action, or centralize it in a base controller / action filter so it can't be forgotten on a
new endpoint.

---

## 5. API endpoints (Controllers)

Base path: `/api/v1`. All authenticated endpoints require `Authorization: Bearer <jwt>`.

**Nothing is ever hard-deleted.** Every `DELETE` route below is a soft delete: it sets that
row's `Status` to `suspended` (or the entity's equivalent inactive state) and leaves the row —
and everything referencing it — in the database. See section 6 for the enforcement rules.

### Auth
```
POST   /api/v1/auth/members/register     { name, email, password }
POST   /api/v1/auth/members/login        { email, password } -> { accessToken, refreshToken, member }
POST   /api/v1/auth/staff/login           { email, password } -> { accessToken, refreshToken, staff }
GET    /api/v1/auth/external/{provider}            members only -> starts Google/Facebook/Microsoft OAuth challenge
GET    /api/v1/auth/external/{provider}/callback    members only -> provider callback, issues accessToken
POST   /api/v1/auth/refresh               { refreshToken } -> { accessToken }
POST   /api/v1/auth/logout
POST   /api/v1/auth/password/forgot       { email }
POST   /api/v1/auth/password/reset        { token, newPassword }
GET    /api/v1/auth/me                    -> current member or staff profile + role
```

### Organizations / Branches / Courts / Rooms / Seats / Packages
Same resource shape as the mock frontend already expects — one controller per resource,
standard REST CRUD, each action running the `BranchScopeHandler` (or organization-level
equivalent) check from section 4:
```
GET/POST/PATCH/DELETE  /api/v1/organizations[/{id}]
GET/POST/PATCH/DELETE  /api/v1/branches[/{id}]
GET/POST/PATCH/DELETE  /api/v1/branches/{branchId}/courts[/{id}]
GET/PUT                /api/v1/courts/{id}/schedule
POST/GET               /api/v1/courts/{id}/exceptions
GET/POST/PATCH/DELETE  /api/v1/branches/{branchId}/rooms[/{id}]
GET/PUT                /api/v1/rooms/{id}/schedule
POST/GET               /api/v1/rooms/{id}/exceptions
GET/POST/PATCH/DELETE  /api/v1/rooms/{roomId}/seats[/{id}]
GET/POST/PATCH/DELETE  /api/v1/branches/{branchId}/packages[/{id}]
GET/POST/PATCH/DELETE  /api/v1/members[/{id}]
GET/POST/PATCH/DELETE  /api/v1/staff-users[/{id}]
```

### Availability
```
GET  /api/v1/courts/{id}/availability?date=2026-07-10
     -> { date, slots: [{ start, end, price, status: "available"|"booked"|"closed" }] }

GET  /api/v1/rooms/{id}/availability?date=2026-07-10
     -> bookingMode=WholeRoom:
          { date, bookingMode, slots: [{ start, end, price, status }] }
        bookingMode=PerSeat:
          { date, bookingMode, seats: [ { seatId, label, slots: [...] } ] }
```
Computed server-side in `AvailabilityService` from the relevant schedule/exception rows minus
existing `Bookings` for that specific court/room/seat — never trust a client-computed slot list.

**`PricingService.GetPriceAsync` — the formula every price in this system runs through:**
```csharp
public async Task<decimal> GetPriceAsync(BookableKind kind, Guid bookableId, DateTimeOffset start, DateTimeOffset end)
{
    if (end <= start) throw new ArgumentException("EndTime must be after StartTime");

    var durationHours = (decimal)(end - start).TotalHours;

    var (baseHourlyRate, overridePrice) = kind switch
    {
        BookableKind.Court => await GetCourtRateAsync(bookableId, start),   // HourlyRate + same-day CourtException.PriceOverride
        BookableKind.Room  => await GetRoomRateAsync(bookableId, start),   // HourlyRate + same-day RoomException.PriceOverride
        BookableKind.Seat  => await GetSeatRateAsync(bookableId, start),   // Seat.HourlyRate (seats have no exception table)
        _ => throw new ArgumentOutOfRangeException(nameof(kind))
    };

    // PriceOverride, where set, replaces the per-hour rate for that date entirely (e.g. a
    // flat holiday rate) rather than stacking with HourlyRate — it is not a discount amount.
    var effectiveHourlyRate = overridePrice ?? baseHourlyRate;

    // decimal, not double, end-to-end; round once at the end, never mid-calculation, and
    // always to the currency's minor unit (2dp for USD) — MidpointRounding.AwayFromZero so a
    // $0.005 slice never quietly rounds down in the venue's favor on every single booking.
    return Math.Round(effectiveHourlyRate * durationHours, 2, MidpointRounding.AwayFromZero);
}
```
Every booking's duration must be an exact multiple of the resource's `SlotMinutes` — enforced
in `BookingService.CreateBookingAsync` before pricing runs, not inside `PricingService` itself,
so a client that somehow sends a 47-minute booking gets a clear `400 Bad Request` instead of a
silently-prorated price.

**`TaxService.CalculateAsync` — the on/off switch for every tax calculation in this system:**
```csharp
public record TaxBreakdown(decimal RatePercent, decimal Amount, decimal Total);

public async Task<TaxBreakdown> CalculateAsync(Guid branchId, decimal subtotal)
{
    var branch = await _db.Branches.SingleAsync(b => b.Id == branchId);

    // The entire tax feature collapses to this one branch. TaxEnabled = false (the default for
    // every existing/new branch) means TaxRatePercent, TaxAmount, FbrInvoiceNumber, FbrQrCode
    // stay 0/null everywhere and the FBR integration below is never called — no partial tax
    // state, no "0% tax row" clutter, nothing to reconcile for branches that don't collect tax.
    if (!branch.TaxEnabled || subtotal == 0)
        return new TaxBreakdown(0m, 0m, subtotal);

    var taxAmount = Math.Round(subtotal * branch.TaxRatePercent / 100m, 2, MidpointRounding.AwayFromZero);
    return new TaxBreakdown(branch.TaxRatePercent, taxAmount, subtotal + taxAmount);
}
```
Prices displayed to members (availability slots, package listings) should already show
`subtotal + tax` when `Branch.TaxEnabled` is true — run the same `CalculateAsync` call inside
`AvailabilityService`/`PackageService`'s read paths so the price a member sees before booking
matches what `CreateBookingAsync` actually charges, instead of surprising them with tax added
only at checkout.

### Packages / purchase
```
POST   /api/v1/packages/{id}/purchase     { paymentMethod: Card|Wallet } -> MemberPackage (+ payment intent if Card)
GET    /api/v1/members/{id}/packages
```
Package purchases run through `TaxService.CalculateAsync(branchId, package.Price)` exactly
like a booking (see "Tax (FBR)" in section 6) — the resulting `Payment.Amount` is
tax-inclusive when the branch has tax enabled, `Payment.TaxAmount` records the tax portion, and
an FBR invoice is filed the same way as a booking's. When `TaxEnabled` is false, this is a
no-op and `Payment.Amount == package.Price` as before.

### Bookings
```
GET    /api/v1/bookings?memberId=&courtId=&roomId=&seatId=&branchId=&status=&from=&to=
POST   /api/v1/bookings   { bookableKind, bookableId, startTime, endTime,
                             paymentMethod: Card|Wallet|Package, memberPackageId? }
GET    /api/v1/bookings/{id}
PATCH  /api/v1/bookings/{id}/cancel      { reason }
PATCH  /api/v1/bookings/{id}/confirm     (internal: e.g. cash payment at front desk)
POST   /api/v1/bookings/{id}/reschedule  { newStartTime, newEndTime }
```

**`BookingService.CreateBookingAsync` (the important part):**
```csharp
public async Task<Booking> CreateBookingAsync(CreateBookingRequest req, Guid memberId)
{
    await using var tx = await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted);
    try
    {
        var price = await _pricingService.GetPriceAsync(req.BookableKind, req.BookableId, req.StartTime, req.EndTime);

        if (req.MemberPackageId is { } packageId)
        {
            // 0 for FixedSessions/BundleHours/UnlimitedMonthly (package fully covers it);
            // a discounted amount > 0 for DiscountPercent, which still owes payment below —
            // see PackageService.RedeemAsync. NOT an "else if": a DiscountPercent redemption
            // paid by Wallet must still hit the Wallet branch for the discounted amount.
            price = await _packageService.RedeemAsync(packageId, memberId, req.BookableKind, req.BookableId, req.StartTime, req.EndTime, price);
        }

        // Tax is computed on the FINAL subtotal — after full package coverage (price == 0, so
        // tax is 0 too) or a DiscountPercent reduction (tax on the discounted amount, matching
        // how FBR expects tax charged on the price actually invoiced, not the list price).
        var tax = await _taxService.CalculateAsync(req.BranchId, price); // { RatePercent, Amount, Total } — all zero if Branch.TaxEnabled == false

        var booking = new Booking
        {
            /* map fields */
            Status = BookingStatus.Pending,
            Price = price,
            TaxRatePercent = tax.RatePercent,
            TaxAmount = tax.Amount,
            Total = tax.Total,
        };
        _db.Bookings.Add(booking);

        await _db.SaveChangesAsync(); // <-- the unique filtered index throws here on a slot conflict; booking.Id now assigned

        if (tax.Total > 0 && req.PaymentMethod == PaymentMethod.Wallet)
        {
            // BookingId is now known, so the WalletDebit row links directly to it — throws
            // InsufficientBalanceException, which rolls back the whole transaction including
            // the booking insert above (no orphaned Pending booking left behind).
            await _walletService.DebitAsync(memberId, tax.Total, WalletDebitReason.BookingPayment, reference: "Booking", bookingId: booking.Id);
        }

        // Confirmed immediately once payment is settled synchronously (fully package-covered,
        // or a wallet debit above already succeeded); Card — including any residual amount
        // after a DiscountPercent redemption — stays Pending until the payment webhook confirms.
        booking.Status = tax.Total == 0 || req.PaymentMethod == PaymentMethod.Wallet
            ? BookingStatus.Confirmed : BookingStatus.Pending;
        await _db.SaveChangesAsync();

        // Fire only when the branch has tax enabled AND the booking is Confirmed — never for a
        // Card booking still sitting Pending, and never at all when Branch.TaxEnabled is false.
        if (booking.Status == BookingStatus.Confirmed && tax.RatePercent > 0)
        {
            await _fbrInvoicingService.EnqueueAsync(booking.Id); // see "Tax (FBR)" below — async, off the request path
        }

        await tx.CommitAsync();
        return booking;
    }
    catch (DbUpdateException ex) when (IsUniqueIndexViolation(ex))
    {
        await tx.RollbackAsync();
        throw new SlotConflictException("This slot was just booked by someone else.");
    }
    catch
    {
        await tx.RollbackAsync();
        throw;
    }
}
```
Map `SlotConflictException` to `409 Conflict` and `InsufficientBalanceException` to
`402 Payment Required` in a global exception filter (`IExceptionFilter` or
`UseExceptionHandler` middleware) so every controller gets consistent error responses without
repeating try/catch.

### Payments — multi-gateway, configured per branch, not hardcoded

The four gateways below cover the required set (**PayFast, JazzCash, EasyPaisa, Stripe**), but
nothing about *which* provider a branch uses is baked into the code — it's data. A branch
enables one or more providers, sets which is the default, and stores each provider's
credentials as rows, not `appsettings.json` constants. Adding a fifth gateway later means
implementing one new class against `IPaymentGatewayProvider` and inserting config rows — zero
changes to `BookingService`, `PaymentController`, or the DB schema.

**Entity — per-branch provider configuration (the "dynamic" part):**
```csharp
public enum PaymentProviderType { Stripe, JazzCash, EasyPaisa, PayFast, Cash, Wallet }

// One row per (Branch, ProviderType) the branch has configured. Cash/Wallet don't need a row —
// they're always available and have no external credentials.
public class BranchPaymentProvider
{
    public Guid Id { get; set; }
    public Guid BranchId { get; set; }
    public PaymentProviderType ProviderType { get; set; }
    public bool IsEnabled { get; set; } = false;
    public bool IsDefault { get; set; } = false;      // exactly one enabled provider per branch/currency is default
    public string CredentialsJson { get; set; } = "{}"; // encrypted at rest — see note below
    public string Currency { get; set; } = "PKR";      // Stripe branches typically set USD/EUR here
    public string Status { get; set; } = "active";      // suspended, not deleted — section 6
}
```
- `CredentialsJson` holds the provider-specific fields (below) and must be encrypted at the
  application layer before it hits SQL Server — use `Microsoft.AspNetCore.DataProtection`'s
  `IDataProtector` to encrypt on write / decrypt on read, so a database backup leak alone
  doesn't leak merchant secrets. Never log this column.
- Admins manage these through ordinary CRUD, following the same soft-delete/suspend pattern as
  everything else in section 6:
  ```
  GET/POST/PATCH/DELETE  /api/v1/branches/{branchId}/payment-providers[/{id}]
  ```
  `PATCH .../{id}` is how an admin flips `IsEnabled`, rotates credentials, or changes the
  default — no redeploy needed to add/remove/reconfigure a gateway for a branch.

**Per-provider `CredentialsJson` shape (what actually goes in that encrypted blob):**

| Provider | Fields | Integration style |
|---|---|---|
| **Stripe** | `SecretKey`, `PublishableKey`, `WebhookSigningSecret` | Hosted Checkout Session / PaymentIntent; async server-to-server webhook, `Stripe-Signature` header |
| **JazzCash** | `MerchantId`, `Password`, `IntegritySalt` | Hosted checkout page redirect; buyer redirected back to a `ReturnUrl` with a `pp_SecureHash` to verify — no true async webhook, verify on return + a status-inquiry API call as source of truth |
| **EasyPaisa** | `StoreId`, `MerchantId`, `HashKey` | Same shape as JazzCash: hosted checkout redirect, HMAC-signed return payload, verify + reconcile via status-inquiry API |
| **PayFast (PK)** | `MerchantId`, `SecuredKey` | Hosted checkout redirect; PayFast posts an Instant Transaction Notification (ITN) to a server callback URL, signature verified against `SecuredKey` |

**`IPaymentGatewayProvider` — the abstraction every controller/service codes against:**
```csharp
public interface IPaymentGatewayProvider
{
    PaymentProviderType Type { get; }

    // Returns whatever the client needs to complete payment: a Stripe Checkout URL / client
    // secret, or a JazzCash/EasyPaisa/PayFast hosted-page redirect URL + signed form fields.
    Task<CheckoutSession> CreateCheckoutAsync(Payment payment, BranchPaymentProvider config, CancellationToken ct);

    // Verifies the inbound callback/webhook signature and maps it to a normalized result.
    // Throws InvalidWebhookSignatureException on a bad signature — never trust the payload
    // otherwise, regardless of provider.
    Task<GatewayCallbackResult> HandleCallbackAsync(HttpRequest request, BranchPaymentProvider config, CancellationToken ct);

    Task<RefundResult> RefundAsync(Payment payment, decimal amount, BranchPaymentProvider config, CancellationToken ct);

    // For redirect-and-return providers (JazzCash/EasyPaisa/PayFast) where the return callback
    // isn't a guaranteed delivery — used by AbandonedBookingCleanupJob (section 7) to confirm a
    // Pending booking is genuinely unpaid before cancelling it. Stripe implements this too (via
    // PaymentIntent retrieval) for consistency, even though its webhook is reliable enough that
    // the cleanup job doesn't bother calling it there.
    Task<PaymentStatus> QueryStatusAsync(Payment payment, CancellationToken ct);
}
```
`PaymentGatewayFactory.Resolve(PaymentProviderType type)` returns the right implementation via
DI (`IEnumerable<IPaymentGatewayProvider>` keyed by `Type`) — `PaymentService` never has a
`switch` on provider type; it asks the factory and calls the interface.

**`PaymentService.CreateIntentAsync` — dynamic provider selection:**
```csharp
public async Task<CheckoutSession> CreateIntentAsync(Guid bookingId, PaymentProviderType? requestedProvider)
{
    var booking = await _db.Bookings.Include(b => b.Branch).SingleAsync(b => b.Id == bookingId);

    var config = await _db.BranchPaymentProviders.SingleOrDefaultAsync(p =>
        p.BranchId == booking.BranchId && p.IsEnabled &&
        (requestedProvider == null ? p.IsDefault : p.ProviderType == requestedProvider))
        ?? throw new NoPaymentProviderConfiguredException(booking.BranchId);

    var payment = new Payment
    {
        BookingId = bookingId,
        Purpose = "booking",
        Amount = booking.Total,                 // tax-inclusive, section 6's Tax (FBR) rules
        TaxAmount = booking.TaxAmount,
        Currency = config.Currency,
        Provider = config.ProviderType.ToString().ToLowerInvariant(),
        Status = "pending",
    };
    _db.Payments.Add(payment);
    await _db.SaveChangesAsync();

    var gateway = _gatewayFactory.Resolve(config.ProviderType);
    return await gateway.CreateCheckoutAsync(payment, config, default);
}
```
A member never picks a raw provider name in isolation — the frontend offers whichever
providers that specific branch has `IsEnabled`, fetched from
`GET /api/v1/branches/{id}/payment-providers` (public, credential fields excluded from the
response — only `ProviderType`/`IsEnabled`/`Currency` are ever returned to a client).

**Endpoints — one shared intent/refund path, one callback per provider (their payload shapes
and signature schemes are too different to multiplex through a single generic webhook):**
```
POST /api/v1/payments/{bookingId}/intent          { provider? } -> CheckoutSession (redirect URL / client secret)
POST /api/v1/payments/{id}/refund                  { amount? }   -> RefundResult

POST /api/v1/payments/callback/stripe               -> Stripe webhook, verifies Stripe-Signature
POST /api/v1/payments/callback/jazzcash              -> JazzCash return post, verifies pp_SecureHash
POST /api/v1/payments/callback/easypaisa             -> EasyPaisa return post, verifies HashKey signature
POST /api/v1/payments/callback/payfast               -> PayFast ITN, verifies SecuredKey signature
```
Every callback handler follows the same shape regardless of provider: verify signature first
(reject with `400` on failure, never touch `Payment`/`Booking` state on an unverified body) →
look up the `Payment` by `ProviderRef` → on success, set `Payment.Status = "paid"`, credit the
wallet or confirm the booking (whichever `Payment.Purpose` indicates) inside one transaction →
on failure, set `Payment.Status = "failed"` and leave the `Booking` `Pending` for the member to
retry with a different provider. This is the one place `BookingService`'s `Pending → Confirmed`
transition happens for **Card** payments (Wallet/Package payments already confirm synchronously
in `CreateBookingAsync`, section 5).

**JazzCash/EasyPaisa/PayFast reconciliation note:** because these three are redirect-and-return
flows rather than guaranteed async webhooks (a buyer can close the browser tab before the
return redirect fires), don't treat the return callback alone as the source of truth for a
Card booking sitting `Pending` for more than a few minutes. `AbandonedBookingCleanupJob`
(section 7) should, before cancelling a `Pending` booking on one of these three providers, make
one status-inquiry API call to the provider (each exposes one: JazzCash's Transaction Status
Inquiry, EasyPaisa's Inquiry API, PayFast's query endpoint) to confirm it's genuinely
unpaid — Stripe doesn't need this extra check since its webhook delivery is reliably retried by
Stripe itself.

### Refunds — implemented per gateway, not left as a TODO

`PaymentService.RefundAsync` is what `BookingService.CancelAsync` calls for a `Card` payment
(section 6); it looks up the `Payment` row, resolves its provider via the same
`PaymentGatewayFactory` used at checkout, and delegates:

```csharp
public async Task<RefundResult> RefundAsync(Guid bookingId, decimal amount)
{
    var payment = await _db.Payments.SingleAsync(p => p.BookingId == bookingId && p.Status == "paid");
    var config = await _db.BranchPaymentProviders.SingleAsync(c =>
        c.BranchId == payment.Booking.BranchId && c.ProviderType == Enum.Parse<PaymentProviderType>(payment.Provider, true));

    var result = await _gatewayFactory.Resolve(config.ProviderType).RefundAsync(payment, amount, config, default);

    payment.Status = result.Status == RefundStatus.Completed ? "refunded" : "pending"; // stays pending until reconciled if ManualReviewRequired
    await _db.SaveChangesAsync();
    return result;
}
```

`RefundResult { Status = Submitted | Completed | ManualReviewRequired, ProviderRefundRef }` —
not every gateway confirms a refund synchronously, so `CancelAsync` marks the refund initiated
without assuming instant completion, and `ManualReviewRequired` refunds get reconciled by
`RefundReconciliationJob` (section 7) or an admin action, never silently treated as done.

**Stripe — native API refund, synchronous:**
```csharp
public async Task<RefundResult> RefundAsync(Payment payment, decimal amount, BranchPaymentProvider config, CancellationToken ct)
{
    var stripeClient = new StripeClient(Decrypt(config.CredentialsJson).SecretKey);
    var refund = await new RefundService(stripeClient).CreateAsync(new RefundCreateOptions
    {
        PaymentIntent = payment.ProviderRef,
        Amount = (long)(amount * 100), // Stripe wants the minor unit (cents)
        Reason = RefundReasons.RequestedByCustomer,
    }, cancellationToken: ct);

    return new RefundResult(
        refund.Status == "succeeded" ? RefundStatus.Completed : RefundStatus.Submitted,
        refund.Id);
}
```

**JazzCash — Refund/Reversal API, hash-signed like every other JazzCash call:**
```csharp
public async Task<RefundResult> RefundAsync(Payment payment, decimal amount, BranchPaymentProvider config, CancellationToken ct)
{
    var creds = Decrypt(config.CredentialsJson);
    var payload = new JazzCashRefundRequest
    {
        pp_MerchantID = creds.MerchantId,
        pp_TxnRefNo = payment.ProviderRef,          // the original pp_TxnRefNo from checkout
        pp_Amount = ToJazzCashAmount(amount),        // JazzCash expects amount in paisa, no decimal point
        pp_TxnCurrency = payment.Currency,
    };
    payload.pp_SecureHash = ComputeHmacSha256Hash(payload, creds.IntegritySalt); // same signing scheme as checkout

    var response = await _http.PostAsJsonAsync($"{JazzCashBaseUrl}/ApplicationAPI/API/Payment/RefundTransaction", payload, ct);
    var body = await response.Content.ReadFromJsonAsync<JazzCashRefundResponse>(ct);

    // JazzCash's refund endpoint responds synchronously with a response code, but settlement
    // to the customer's mobile account can lag — treat "0000" (success) as Submitted, not
    // Completed, and let RefundReconciliationJob's status-inquiry call confirm settlement.
    return body!.pp_ResponseCode == "000"
        ? new RefundResult(RefundStatus.Submitted, body.pp_TxnRefNo)
        : new RefundResult(RefundStatus.ManualReviewRequired, body.pp_TxnRefNo);
}
```

**EasyPaisa — same shape, its own Refund API and hash scheme:**
```csharp
public async Task<RefundResult> RefundAsync(Payment payment, decimal amount, BranchPaymentProvider config, CancellationToken ct)
{
    var creds = Decrypt(config.CredentialsJson);
    var payload = new EasyPaisaRefundRequest
    {
        storeId = creds.StoreId,
        orderId = payment.ProviderRef,
        transactionAmount = amount.ToString("F2"),
    };
    payload.hash = ComputeHmacSha256Hash(payload, creds.HashKey);

    var response = await _http.PostAsJsonAsync($"{EasyPaisaBaseUrl}/easypay/Confirm/refund", payload, ct);
    var body = await response.Content.ReadFromJsonAsync<EasyPaisaRefundResponse>(ct);

    return body!.responseCode == "0000"
        ? new RefundResult(RefundStatus.Submitted, body.transactionId)
        : new RefundResult(RefundStatus.ManualReviewRequired, body.transactionId);
}
```

**PayFast (PK) — refund request, signature verified the same way as its ITN:**
```csharp
public async Task<RefundResult> RefundAsync(Payment payment, decimal amount, BranchPaymentProvider config, CancellationToken ct)
{
    var creds = Decrypt(config.CredentialsJson);
    var payload = new PayFastRefundRequest
    {
        merchant_id = creds.MerchantId,
        pf_payment_id = payment.ProviderRef,
        amount = amount.ToString("F2"),
    };
    payload.signature = ComputeMd5Signature(payload, creds.SecuredKey);

    var response = await _http.PostAsJsonAsync($"{PayFastBaseUrl}/refunds", payload, ct);
    var body = await response.Content.ReadFromJsonAsync<PayFastRefundResponse>(ct);

    return body!.status == "success"
        ? new RefundResult(RefundStatus.Submitted, body.refund_id) // PayFast confirms completion via a later ITN callback
        : new RefundResult(RefundStatus.ManualReviewRequired, body.refund_id);
}
```

**`RefundReconciliationJob` (section 7 pattern, another `BackgroundService`)** polls `Payment`
rows with `Status = "pending"` and a non-null refund reference on a fixed interval, calls each
provider's status-inquiry endpoint (the same one `QueryStatusAsync` uses for the abandoned-
booking check), and flips `Payment.Status` to `"refunded"` once the provider confirms
settlement — or raises a staff notification if a refund has sat `ManualReviewRequired` past a
configurable threshold, since JazzCash/EasyPaisa mobile-account refunds can require manual
merchant-portal action per their docs.

### Wallet
```
GET    /api/v1/members/{id}/wallet
GET    /api/v1/members/{id}/wallet/credits     -> WalletCredit rows (recharges, refunds, adjustments)
GET    /api/v1/members/{id}/wallet/debits      -> WalletDebit rows (booking payments, package purchases, adjustments)
POST   /api/v1/members/{id}/wallet/recharge   { amount, paymentMethodToken }
```
`GET .../transactions` isn't a real endpoint — the frontend merges `credits` and `debits`
client-side (sorted by `CreatedAt`) if it needs one combined statement view; the backend never
materializes a merged table, so the two ledgers stay genuinely separate end to end.
A recharge creates a `Payment` (`Purpose = wallet_recharge`, `Status = pending`) and only
credits the `Wallet` once the payment webhook confirms success — never credit on request
receipt.

**`WalletService.DebitAsync` — the concurrency-safe part:**
```csharp
public async Task DebitAsync(Guid memberId, decimal amount, WalletDebitReason reason, string reference, Guid? bookingId = null, Guid? memberPackageId = null)
{
    var wallet = await _db.Wallets.SingleAsync(w => w.MemberId == memberId);
    if (wallet.Balance < amount) throw new InsufficientBalanceException();

    wallet.Balance -= amount; // EF Core's RowVersion concurrency token (section 2) makes this
    _db.WalletDebits.Add(new WalletDebit
    {
        MemberId = memberId, Reason = reason, Amount = amount, BalanceAfter = wallet.Balance,
        Reference = reference, BookingId = bookingId, MemberPackageId = memberPackageId,
    });
    await _db.SaveChangesAsync(); // <-- DbUpdateConcurrencyException here if another debit raced it
}
```
And symmetrically, `WalletService.CreditAsync` writes to `WalletCredit` instead — never to the
same table as `DebitAsync`:
```csharp
public async Task CreditAsync(Guid memberId, decimal amount, WalletCreditReason reason, string reference, Guid? paymentId = null, Guid? bookingId = null)
{
    var wallet = await _db.Wallets.SingleAsync(w => w.MemberId == memberId);
    wallet.Balance += amount;
    _db.WalletCredits.Add(new WalletCredit
    {
        MemberId = memberId, Reason = reason, Amount = amount, BalanceAfter = wallet.Balance,
        Reference = reference, PaymentId = paymentId, BookingId = bookingId,
    });
    await _db.SaveChangesAsync(); // same RowVersion concurrency protection as DebitAsync
}
```
`Wallet.RowVersion` (an EF Core concurrency token, i.e. SQL Server `rowversion`/`timestamp`
column) means two concurrent debits on the same wallet can't both silently succeed — the
second one's `SaveChangesAsync` throws `DbUpdateConcurrencyException`, which the caller should
retry (re-read the wallet, re-check the balance) rather than swallow. This is the wallet's
equivalent of the booking slot's unique index: the database, not application code, is what
prevents an overdraft under concurrency.

### Reporting
```
GET /api/v1/reports/revenue?branchId=&from=&to=&groupBy=day|week|month
GET /api/v1/reports/utilization?courtId=&from=&to=
GET /api/v1/reports/bookings-summary?organizationId=&from=&to=
```

**Revenue = booking revenue, and it is defined as one specific sum to avoid double-counting.**
`Payment` rows exist for three different `Purpose`s (`booking`, `package_purchase`,
`wallet_recharge`), and a single booking's money can appear in more than one of them (e.g. a
member recharges the wallet, then spends it on a booking) — summing all `Payment.Amount` rows
in a date range double-counts that money. `revenue` sums **`Booking.Price` for bookings whose
`Status` is `Confirmed` or `Completed`** in the range (by `StartTime`, not `CreatedAt`), plus
`Package.Price` for `MemberPackage` purchases in the same range attributed separately, never
merged into the same total — wallet recharges are a balance transfer, not revenue, and are
excluded entirely. Cancelled bookings contribute `0`, refunded or not, since `Booking.Price` is
gross of any later refund — a cancelled booking's revenue is already `0` by virtue of being
excluded, so there's no separate refund-subtraction step to get wrong.

### Notifications
```
GET  /api/v1/notifications?memberId=
POST /api/v1/notifications/{id}/mark-read
```
Sending itself is a background job (see section 7) triggered by booking lifecycle events, not
a synchronous call the controller action makes directly — the action should only ever enqueue
the notification, never block the HTTP response on an email/SMS provider round-trip.

---

## 6. Business rules checklist

### Soft delete only — nothing is ever physically removed

Every entity in section 2 already carries a `Status` string (`active`/`inactive`/`banned`/
`pending`/etc.) for exactly this reason. Standardize the "removed" value across all of them as
`"suspended"` and follow these rules everywhere, without exception:

- **No controller action, service method, or migration ever issues a SQL `DELETE`** against a
  business entity (`Organization`, `Branch`, `Court`, `Room`, `Seat`, `Package`, `Member`,
  `StaffProfile`, `Booking`, `Payment`, `BranchPaymentProvider`, `WalletCredit`, `WalletDebit`,
  `Notification`, ...). A `DELETE`
  HTTP route maps to `entity.Status = "suspended"` + `SaveChangesAsync()`, never
  `_db.Remove(entity)`.
- **Enforce it at the repository/service layer, not just by convention** — give
  `BookingHubDbContext` a single `SuspendAsync<T>(T entity)` helper that every
  service/controller calls instead of `Remove`, so there's one place to audit rather than
  trusting every controller action individually.
- **Reads exclude suspended rows by default.** Add an EF Core global query filter
  (`modelBuilder.Entity<T>().HasQueryFilter(e => e.Status != "suspended")`) on every entity
  with a `Status` column, so a suspended `Court`/`Member`/`Package` silently disappears from
  normal listings/availability without any extra `Where` clauses scattered through the
  codebase. Admin-only "show suspended" screens use `.IgnoreQueryFilters()` explicitly.
- **Cascades become status cascades, not row cascades.** Suspending a `Branch` should cascade
  to suspending its `Court`/`Room`/`Package` rows (and suspending a `Room` cascades to its
  `Seat` rows) inside the same service method/transaction — never rely on a DB `ON DELETE
  CASCADE`, since nothing is ever deleted.
- **Bookings are never suspended by this mechanism** — a booking's lifecycle is
  `Pending → Confirmed → Completed/Cancelled/NoShow` (section 2's `BookingStatus`), and
  "cancel" (`PATCH /bookings/{id}/cancel`) already is the non-destructive equivalent for that
  entity. Don't also add `Status = "suspended"` on top of `BookingStatus` — keep one status
  enum per entity.
- **Suspending a resource with active bookings/wallet balance is a guarded operation** — e.g.
  suspending a `Court`/`Room`/`Seat` should block new bookings against it going forward but
  must not touch existing `Booking` rows; suspending a `Member` should not touch their
  `Wallet.Balance` or `WalletCredit`/`WalletDebit` history. Never let a suspend action silently mutate
  unrelated financial/ledger data.
- **Uniqueness constraints must account for suspended rows** — e.g. re-registering a `Member`
  with an email that belongs to a suspended account should reactivate/relink that account
  rather than fail on a duplicate-email constraint or silently create a second row for the
  same person.

- A slot becomes visible for booking only from `CourtSchedule`/`CourtException` (or the
  `Room*` equivalents), computed inside `AvailabilityService`; never hardcode business hours
  in the frontend.
- Cancellation cutoff (e.g., "free cancellation up to 6 hours before start") is a per-branch,
  per-court, or per-room configurable rule, enforced inside `BookingService.CancelAsync`.
- No-show handling: a background job (section 7) marks past `Confirmed` bookings with no
  check-in as `NoShow` after a grace period, optionally penalizing repeat no-shows.
- Refund policy tied to cancellation timing — compute inside `BookingService.CancelAsync`,
  never let the client decide the refund amount.
- All monetary calculations happen inside `PricingService` from `Court.HourlyRate` /
  `Room.HourlyRate` / `Seat.HourlyRate` / the relevant `*Exception.PriceOverride` — the
  frontend only displays, never sets, price.

**`BookingService.CancelAsync` — the refund formula (a tiered `%` of `Booking.Price`, config
per-branch, falling back to an org default so every branch isn't forced to set one):**
```csharp
public async Task CancelAsync(Guid bookingId, Guid memberId, string reason)
{
    var booking = await _db.Bookings.SingleAsync(b => b.Id == bookingId && b.MemberId == memberId);
    if (booking.Status is BookingStatus.Cancelled or BookingStatus.Completed or BookingStatus.NoShow)
        throw new InvalidOperationException("Booking cannot be cancelled in its current state.");

    var hoursUntilStart = (decimal)(booking.StartTime - DateTimeOffset.UtcNow).TotalHours;
    var policy = await _cancellationPolicyService.GetPolicyAsync(booking); // per-court/room -> branch -> org fallback

    // e.g. { >=24h: 100%, >=6h: 50%, else: 0% } — the policy's own tiers, not hardcoded here.
    var refundPercent = policy.GetRefundPercent(hoursUntilStart);
    // Refund basis is Total (tax-inclusive), not Price — a member who paid Rs. 1,170 (Rs.
    // 1,000 + 17% GST) gets Rs. 1,170 back at 100%, never just the Rs. 1,000 subtotal. When
    // Branch.TaxEnabled is false, TaxAmount is 0 and Total == Price, so this is a no-op there.
    var refundAmount = Math.Round(booking.Total * refundPercent / 100m, 2, MidpointRounding.AwayFromZero);

    booking.Status = BookingStatus.Cancelled;
    booking.CancelledAt = DateTimeOffset.UtcNow;
    booking.CancelReason = reason;

    // Refund only what was actually paid in money — a package redemption (Price == 0, or the
    // pre-discount amount covered by session/hours balance) is refunded by restoring the
    // package balance, never by crediting the wallet for money that was never charged.
    if (booking.MemberPackageId is { } packageId && refundPercent == 100)
    {
        await _packageService.RestoreBalanceAsync(packageId, booking); // undo the RedeemAsync decrement
    }
    else if (refundAmount > 0)
    {
        switch (booking.PaymentMethod)
        {
            case PaymentMethod.Wallet:
                await _walletService.CreditAsync(memberId, refundAmount,
                    WalletCreditReason.Refund, reference: "Booking cancellation", bookingId: bookingId);
                break;
            case PaymentMethod.Card:
                await _paymentService.RefundAsync(booking.Id, refundAmount); // dispatches to the right gateway, see below
                break;
        }
    }

    await _db.SaveChangesAsync();
}
```
`refundAmount` is always derived from `Booking.Price` — the amount actually recorded at booking
time — never recomputed from the current `HourlyRate`/`PriceOverride`, which may have changed
since the booking was made.

A `WalletTransaction`/provider-refund call is unnecessary when `refundAmount == 0` (the 0%
tier), but the `Notification` sent on cancellation should still say plainly "no refund" so the
member isn't left guessing whether one is still processing.

### Court vs. Zone specifics

- **Court venues:** always single-unit bookings. The owner sets one `HourlyRate` per court
  (optionally overridden per date via `CourtException.PriceOverride`, e.g. weekend surge
  pricing). No sub-division — this path is the simple case.
- **Zone venues:** the room's `GameType` determines its natural `Capacity` (FIFA room = 2,
  CS2 room = 5, open PC lounge = however many PCs) — set once when the room is created, not
  chosen by the customer.
  - `BookingMode.WholeRoom`: behaves like a court — one booking blocks the whole room for that
    time range, priced at `Room.HourlyRate`.
  - `BookingMode.PerSeat`: each `Seat` is booked independently at `Seat.HourlyRate`; booking
    "1 PC" only reserves that seat, other seats in the room remain independently bookable for
    the same time range.
  - A branch can mix both: 3 private `WholeRoom` CS2 rooms for groups, plus 1 large `PerSeat`
    open PC lounge for walk-ins — just different `Room` rows with different `BookingMode`.

### Packages

- A package is always scoped (`Package.Scope` + `ScopeId`) to exactly one court, room, seat,
  or the whole branch (`Scope = Branch` means redeemable against anything in that branch —
  useful for a generic "10-hour credit pack").
- Purchasing a package is itself a payment — `MemberPackage` is only created after that
  payment succeeds, with `SessionsRemaining`/`HoursRemaining` initialized from the package
  definition and `ExpiresAt` set from `ValidDays`.
- `BookingService.CreateBookingAsync` with `MemberPackageId` set must, inside the same
  transaction as the booking insert: (1) verify the package isn't expired and has remaining
  balance, (2) verify the package's scope actually covers the requested court/room/seat,
  (3) decrement the balance and set `Booking.Price`. Never split this across two separate
  calls/requests — a crash between them silently loses or duplicates balance.
- `UnlimitedMonthly` packages don't decrement a counter — the check is purely
  `ExpiresAt > DateTimeOffset.UtcNow`.
- **`DiscountPercent` packages are not a balance to consume — they never zero out the price.**
  This is the one package type that behaves differently from the other three, and conflating
  them is an easy bug: a `FixedSessions`/`BundleHours`/`UnlimitedMonthly` redemption fully
  covers the booking (`Booking.Price = 0`), but `DiscountPercent` only reduces the price that
  then still gets charged via the member's chosen `PaymentMethod` (Card or Wallet).

  ```csharp
  public async Task<decimal> RedeemAsync(
      Guid memberPackageId, Guid memberId, BookableKind kind, Guid bookableId,
      DateTimeOffset start, DateTimeOffset end, decimal basePrice)
  {
      var mp = await _db.MemberPackages.Include(m => m.Package)
          .SingleAsync(m => m.Id == memberPackageId && m.MemberId == memberId);

      if (mp.Status != "active" || mp.ExpiresAt <= DateTimeOffset.UtcNow)
          throw new PackageNotRedeemableException("Package expired or inactive.");
      if (!ScopeCoversBookable(mp.Package, kind, bookableId))
          throw new PackageNotRedeemableException("Package does not cover this court/room/seat.");

      switch (mp.Package.PackageType)
      {
          case PackageType.UnlimitedMonthly:
              return 0m; // no counter to decrement, expiry check above is the only gate

          case PackageType.FixedSessions:
              if (mp.SessionsRemaining is null or <= 0) throw new PackageNotRedeemableException("No sessions remaining.");
              mp.SessionsRemaining--;
              if (mp.SessionsRemaining == 0) mp.Status = "exhausted";
              return 0m;

          case PackageType.BundleHours:
              var durationHours = (decimal)(end - start).TotalHours;
              if (mp.HoursRemaining is null || mp.HoursRemaining < durationHours)
                  throw new PackageNotRedeemableException("Not enough hours remaining.");
              mp.HoursRemaining -= durationHours;
              if (mp.HoursRemaining == 0) mp.Status = "exhausted";
              return 0m;

          case PackageType.DiscountPercent:
              // Does NOT touch SessionsRemaining/HoursRemaining — there is no balance to
              // exhaust, so it never sets Status = "exhausted" and is reusable until ExpiresAt.
              var discount = mp.Package.DiscountPercent ?? 0m;
              return Math.Round(basePrice * (1 - discount / 100m), 2, MidpointRounding.AwayFromZero);

          default:
              throw new InvalidOperationException($"Unhandled package type {mp.Package.PackageType}");
      }
  }
  ```
  Because `DiscountPercent` returns a non-zero price, `CreateBookingAsync` still needs to run
  its normal `Wallet`-debit step (or leave the booking `Pending` for a card charge) for that
  returned amount — a `DiscountPercent` redemption is not itself a payment, only a price
  adjustment. `Booking.MemberPackageId` should still be set so reporting can attribute the
  discount, but `Booking.PaymentMethod` reflects how the *discounted* amount was actually paid.

### Wallet

- `Wallet.Balance` is the source of truth; `WalletCredit` and `WalletDebit` are append-only
  ledgers for history/auditing — never delete or edit a row in either, only insert. Keeping
  them as two tables (rather than one signed-amount table) means `SUM(WalletCredit.Amount)` /
  `SUM(WalletDebit.Amount)` for a period are two direct, unambiguous queries with nothing to
  filter — the shape an accountant/FBR audit expects, and there's no code path that could
  accidentally write a credit with a negative amount into the debit column or vice versa.
- **Recharging** always goes through a real payment provider first. Credit the wallet
  (`WalletCreditReason.Recharge`) only inside the payment webhook handler, after the provider
  confirms — crediting on request receipt instead of on confirmed payment lets a failed or
  fraudulent charge still add funds.
- **Spending** (`WalletService.DebitAsync`, `Reason = BookingPayment` or `PackagePurchase`)
  relies on the `RowVersion` concurrency token (see section 5) plus a balance check in the same
  `SaveChangesAsync` transaction as the booking/package insert — never a check-then-decrement
  split across two round-trips.
- **Refunds** (e.g. a cancelled booking paid via wallet) credit the wallet back with a
  `WalletCredit { Reason = Refund }` row linked to the original `BookingId`, inside
  `BookingService.CancelAsync` — never write a `WalletDebit` row for a refund and never reuse a
  `Payment`-type row for one either; a refund is always a `WalletCredit`, so which table a row
  lives in already tells you the direction of money without reading a `Type` column.
- The wallet balance can never go negative — enforced by the balance check in `DebitAsync`
  (and add a SQL Server `CHECK (Balance >= 0)` constraint via raw SQL in the migration as a
  last line of defense if that check is ever bypassed by a bug).

### Tax (FBR) — off by default, on only where a branch collects it

Most branches will never turn this on. Tax only enters any calculation when
`Branch.TaxEnabled == true`; otherwise every code path in this document that mentions tax is
a no-op (`TaxRatePercent = 0`, `TaxAmount = 0`, `Total = Price`, no FBR API call). That flag —
not a global config value — is the single source of truth, since different branches of the
same organization can have different tax obligations (e.g. one branch below the FBR retail
tax-registration threshold, another above it).

- **What gets taxed:** booking revenue (`Booking.Price`) and package purchases
  (`Package.Price`) — both are sales of a service. **Wallet recharges are never taxed** — a
  recharge is a balance transfer, not a sale; tax is applied once, when that balance is later
  *spent* on a taxed booking/package, not twice.
- **Rate & registration are per-branch config, not hardcoded:** `Branch.TaxRatePercent` (e.g.
  `17.00` for Pakistan's standard GST on services — confirm the branch's actual applicable
  rate/category with FBR, since rates vary by province and service type) and
  `Branch.FbrPosRegistrationNumber`, the POS ID issued when the branch registers with FBR's
  Point of Sale integration under SRO 1006(I)/2021. `Organization.NtnNumber` is the org's own
  National Tax Number, printed on every invoice this branch issues.
- **Tax-inclusive display:** once `TaxEnabled` is true, every price the member sees
  (availability slots, package listings, checkout) already includes tax — never show a
  tax-exclusive price and add tax as a surprise line item at payment.
- **FBR digital invoicing integration** — when a taxed booking is `Confirmed` (synchronous
  package/wallet payment) or a Card payment webhook confirms it, `CreateBookingAsync` enqueues
  an `FbrInvoicingService.EnqueueAsync(bookingId)` call (never inline on the request path — an
  FBR API outage must not block booking confirmation):
  ```csharp
  public class FbrInvoiceDispatchJob : BackgroundService
  {
      // picks up Bookings with TaxAmount > 0 and FbrInvoiceNumber == null
      protected override async Task ExecuteAsync(CancellationToken stoppingToken)
      {
          using var scope = _scopeFactory.CreateScope();
          var db = scope.ServiceProvider.GetRequiredService<BookingHubDbContext>();

          var pending = await db.Bookings
              .Where(b => b.TaxAmount > 0 && b.FbrInvoiceNumber == null && b.Status == BookingStatus.Confirmed)
              .Take(50).ToListAsync(stoppingToken);

          foreach (var booking in pending)
          {
              var payload = new FbrInvoiceRequest
              {
                  PosRegistrationNumber = booking.Branch.FbrPosRegistrationNumber!,
                  BuyerNtn = null, // walk-in/consumer sale — FBR allows an unregistered buyer
                  InvoiceType = "Sale Invoice",
                  ValueExcludingTax = booking.Price,
                  TaxRate = booking.TaxRatePercent,
                  TaxAmount = booking.TaxAmount,
                  ValueIncludingTax = booking.Total,
                  InvoiceDateTime = booking.CreatedAt,
              };

              var response = await _fbrClient.PostInvoiceAsync(payload, stoppingToken); // FBR's real-time POS invoicing API
              booking.FbrInvoiceNumber = response.FbrInvoiceNumber; // FBR-assigned sequential invoice number
              booking.FbrQrCode = response.QrCodeBase64;            // printed on the receipt for buyer verification
          }

          await db.SaveChangesAsync(stoppingToken);
      }
  }
  ```
  - **Config (per environment, never committed):** `Fbr:BaseUrl` (FBR provides separate
    sandbox and production endpoints — test against sandbox until the branch's POS
    registration is verified), `Fbr:ClientId`/`Fbr:ClientSecret` or bearer token issued at POS
    registration.
  - **Failure handling:** same bounded-retry pattern as the WhatsApp/Resend senders — a failed
    call leaves `FbrInvoiceNumber == null` so the job retries it on the next run; the booking
    itself stays `Confirmed` regardless (tax filing is a compliance side-effect, never a
    condition for the customer's booking to succeed). Alert staff (not the member) if a
    booking has gone unfiled for longer than a configurable threshold (e.g. 24h), since FBR
    POS integration rules require real-time or near-real-time invoice reporting.
  - **Receipts:** the receipt/confirmation shown to the member (and the confirmation
    email/WhatsApp message, sections 7's Resend/WhatsApp senders) includes `FbrInvoiceNumber`
    and renders `FbrQrCode` once populated; before that, show the receipt without them rather
    than blocking on FBR confirmation.
- **Cancellations/refunds already flow through correctly** (see `BookingService.CancelAsync`
  above): the refund is computed off `Booking.Total`, which is tax-inclusive, so a member is
  always refunded the tax they actually paid, not just the pre-tax subtotal. FBR credit-note
  filing for a cancelled/refunded invoice is the same enqueue-and-retry pattern as filing the
  original invoice — flag as a follow-up to implement analogously to
  `FbrInvoiceDispatchJob` if/when a branch with `TaxEnabled = true` needs it; don't build it
  speculatively for branches that never turn tax on.
- **Reporting:** the revenue report (section 5, "Reporting") sums `Booking.Price` (tax-
  exclusive) as revenue and must report `Booking.TaxAmount` collected in the same range as a
  **separate line**, never folded into revenue — FBR filing needs tax-collected reported on
  its own, and conflating the two would overstate the business's actual revenue.

### Localization (i18n) — content in multiple languages, switchable live from the frontend

Same principle as "Configuration philosophy" above: translated text is data (`Translation`
rows), not a hardcoded string or a second hardcoded column per language. Adding Urdu, Arabic,
or any other language to an existing deployment is inserting rows through the API — no code
change, no migration, no redeploy, and the frontend's language switcher takes effect on the
very next request because the language is a per-request parameter, not baked into a cached
response.

- **What's translatable:** any user-facing text field on any entity — `Branch.Name`/
  `Description`, `Court.Name`, `Room.Name`/`GameType` display label, `Package.Name`,
  amenity labels, notification template subject/body per `Notification.Type`, and the "no
  refund" / cancellation-reason copy from section 6's refund rules. Structural fields (IDs,
  enums, prices, dates, statuses) are never translated — only display strings.
- **How a language is chosen per request** (highest priority wins): `?lang=ur` query param
  (explicit override, e.g. a language switcher in the UI) → `Accept-Language` request header →
  the authenticated member's `Member.PreferredLanguage` → the branch's
  `Branch.NotificationLanguage` → the platform default (`"en"`). This resolution happens once,
  in an `ActionFilter`/middleware that sets a `CurrentLanguage` ambient value for the request —
  controllers/services never re-derive it.
- **`ILocalizationService` — how a controller/service reads translated content:**
  ```csharp
  public interface ILocalizationService
  {
      // Returns the Translation.Value for (entityType, entityId, field, language), falling
      // back to the entity's own base-language column (e.g. Court.Name) if no row exists yet
      // for that language — a court with only an English name never renders blank in Urdu.
      Task<string> GetAsync(string entityType, Guid entityId, string field, string language, string fallback);

      // Batches lookups for a list response (availability slots, court listings) into one
      // query instead of N — never resolve translations in a per-row loop.
      Task<Dictionary<Guid, string>> GetManyAsync(string entityType, IEnumerable<Guid> entityIds, string field, string language);
  }
  ```
  DTO mapping (e.g. `CourtDto.Name`) calls `GetAsync("Court", court.Id, "Name", CurrentLanguage, court.Name)` instead of reading `court.Name` directly — that's the one-line change every read path needs, and it's the same call regardless of which entity or which language.
- **Writing translations (admin/staff only, ordinary CRUD):**
  ```
  GET    /api/v1/translations?entityType=Court&entityId={id}           -> all languages for one entity
  PUT    /api/v1/translations                { entityType, entityId, field, languageCode, value }  -> upsert one
  PUT    /api/v1/translations/bulk           [{ entityType, entityId, field, languageCode, value }] -> upsert many, one save
  DELETE /api/v1/translations/{id}                                                                    -> real delete, not suspend
  ```
  `PUT` (not `POST`) because writing a translation is idempotent — the same
  (`EntityType`,`EntityId`,`FieldName`,`LanguageCode`) always overwrites the same row via the
  unique index in `OnModelCreating`, never creates a duplicate. `Translation` is the one entity
  in this spec exempt from section 6's "nothing is ever hard-deleted" rule: it's replaceable UI
  copy with no financial/audit trail to preserve, unlike a `Booking` or `Payment` — removing a
  stale translation (e.g. a language a branch no longer supports) is a genuine `DELETE`.
- **Notification templates are translations too** — `Resend`/`WhatsApp` senders (section 7)
  resolve subject/body through the same `ILocalizationService` call keyed by
  `Notification.Type` + the recipient's language (member's `PreferredLanguage`, not the
  branch's, since a member's language preference should follow them across branches), so a
  Google/Facebook social-login member who set their language to Urdu gets Urdu emails and
  WhatsApp messages without any special-casing in the sender classes.
- **Frontend language switch is just the `lang` param** — when a member flips the language
  toggle in the UI, the frontend re-requests the same endpoints with `?lang=ur` (or updates the
  stored `Accept-Language`); nothing server-side needs to change per request beyond that one
  parameter, since every read path already resolves through `ILocalizationService`. If the
  member is authenticated, the frontend should also call
  `PATCH /api/v1/members/{id} { preferredLanguage: "ur" }` so the choice persists across
  sessions and devices, and future notifications use it too.
- **What's never translated dynamically:** compliance-fixed text — the FBR invoice fields
  (section 6, "Tax (FBR)") stay in whatever language FBR's own format requires, independent of
  the member's UI language, since that document has a regulatory audience, not the member.

---

## 7. Background jobs

Use **`IHostedService`/`BackgroundService`** for simple recurring work, or **Hangfire** (with
SQL Server as its storage, so no extra infrastructure) if you want a dashboard and retry
semantics:

```csharp
public class AbandonedBookingCleanupJob : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<BookingHubDbContext>();

            // Per-branch timeout, not a hardcoded "-10" — a branch that leans on the slower
            // JazzCash/EasyPaisa/PayFast redirect flows may want a longer window than one on
            // Stripe only. Grouping by branch avoids a per-row subquery on every poll.
            foreach (var group in await db.Bookings
                .Where(b => b.Status == BookingStatus.Pending && b.PaymentMethod == PaymentMethod.Card)
                .Include(b => b.Branch)
                .GroupBy(b => b.Branch.CardPaymentTimeoutMinutes)
                .ToListAsync(stoppingToken))
            {
                var cutoff = DateTimeOffset.UtcNow.AddMinutes(-group.Key);
                var ids = group.Where(b => b.CreatedAt < cutoff).Select(b => b.Id);

                foreach (var booking in group.Where(b => ids.Contains(b.Id)))
                {
                    var payment = await db.Payments.SingleOrDefaultAsync(p => p.BookingId == booking.Id, stoppingToken);
                    var providerType = payment is null ? null : Enum.Parse<PaymentProviderType>(payment.Provider, ignoreCase: true);

                    if (providerType is PaymentProviderType.JazzCash or PaymentProviderType.EasyPaisa or PaymentProviderType.PayFast)
                    {
                        // Redirect-and-return flows aren't guaranteed webhooks — confirm via the
                        // provider's own status-inquiry API before cancelling, per the
                        // reconciliation note in section 5's "Payments — multi-gateway".
                        var status = await _gatewayFactory.Resolve(providerType.Value).QueryStatusAsync(payment!, stoppingToken);
                        if (status == PaymentStatus.Paid) continue; // webhook just hadn't landed yet — leave it, don't cancel
                    }

                    booking.Status = BookingStatus.Cancelled;
                    booking.CancelReason = "payment timeout";
                }

                await db.SaveChangesAsync(stoppingToken);
            }

            await Task.Delay(_options.CleanupPollInterval, stoppingToken); // appsettings, default 5 min — platform-wide poll cadence, not per-branch
        }
    }
}
```

Register a second one, polling on the same platform-wide interval, for marking no-shows
(`Confirmed` bookings whose `EndTime` plus that branch's `NoShowGraceMinutes` has passed with
no check-in — read per-row from `Branch`, not a single hardcoded grace period for every venue).
Wallet and package payments never reach the "abandoned" state since they resolve synchronously
inside the original request — this job only matters for `PaymentMethod.Card` bookings waiting
on a webhook or redirect-return confirmation.

Notifications: raise a domain event (or just enqueue directly) when `Booking.Status` changes to
`Confirmed`/`Cancelled` inside `BookingService`, and have a `NotificationDispatchJob`
(`BackgroundService` or a Hangfire recurring job) pick up `Notification` rows with
`Status = pending` and send them via your email/SMS/WhatsApp provider, updating `SentAt`/`Status`
after. Keep this off the request path — the controller action that changes booking status
should never block on an email provider round-trip.

### Email channel (Resend)

`Notification.Channel = "email"` rows — and any transactional email outside the notification
queue (password reset, staff invite) — are sent through **Resend** (`resend.com`), not SMTP.

- **Prerequisites (Resend side, one-time setup, not code):** a Resend account, the sending
  domain (e.g. `bookings.yourdomain.com`) verified via its DNS records (SPF/DKIM/DMARC entries
  Resend gives you), and an API key scoped to that domain.
- **Config (`appsettings.json` keys, values from user-secrets / Key Vault, never committed):**
  ```json
  "Resend": {
    "ApiKey": "re_...",
    "FromAddress": "Booking Hub <bookings@bookings.yourdomain.com>",
    "ReplyTo": "support@yourdomain.com"
  }
  ```
- **Package:** `Resend` (official .NET SDK, `dotnet add package Resend`), registered via
  `builder.Services.AddHttpClient<ResendClient>()` per its own setup docs — or a plain
  `IHttpClientFactory` client posting to `https://api.resend.com/emails` if you'd rather not
  take the SDK dependency; both are thin wrappers over the same REST call.
- **`ResendNotificationSender` (implements the same `INotificationSender` used by the WhatsApp
  sender above — `NotificationDispatchJob` picks between them by `Notification.Channel`):**
  ```csharp
  public class ResendNotificationSender : INotificationSender
  {
      private readonly IResend _resend; // or HttpClient, per the setup note above
      private readonly ResendOptions _opts;

      public async Task SendAsync(Notification notification, CancellationToken ct)
      {
          var (subject, html) = BuildEmailContent(notification.Type, notification); // template per Type

          var response = await _resend.EmailSendAsync(new EmailMessage
          {
              From = _opts.FromAddress,
              To = { notification.RecipientEmail },
              ReplyTo = { _opts.ReplyTo },
              Subject = subject,
              HtmlBody = html
          }, ct);

          notification.ProviderMessageId = response.Content.ToString(); // Resend email id, for status correlation
      }
  }
  ```
  Content per `Notification.Type` (`booking_confirmed`, `reminder`, `cancelled`,
  `password_reset`, `staff_invite`, ...) is built from Razor Class Library views
  (`ITemplateRenderer`/`RazorViewToStringRenderer`, a common pattern for rendering `.cshtml`
  as an email body outside of a normal MVC response) or a simple HTML-template-per-type
  approach — either way, keep templates out of the C# string literals so copy changes don't
  need a redeploy of application logic, just the template.
- **Delivery status webhook** — Resend calls back with `email.delivered`/`email.bounced`/
  `email.complained` events:
  ```
  POST /api/v1/webhooks/resend
  ```
  Verify the `svix-signature` header (Resend webhooks are signed via Svix) before trusting the
  payload, same principle as the payment and WhatsApp webhooks — never act on an unverified
  body. Match the incoming `email_id` to `Notification.ProviderMessageId` and update
  `Status`/`SentAt`; on `email.bounced`/`email.complained`, also flag `Member.EmailOptIn =
  false` so `NotificationDispatchJob` stops retrying that address.
- **Failure handling:** same pattern as WhatsApp — a non-2xx response from Resend leaves
  `Notification.Status = "pending"` for `NotificationDispatchJob`'s bounded retry, never
  `failed` on the first attempt, and never blocks other queued notifications.
- **Password reset / staff invite emails** (section 3) should go through this same
  `ResendNotificationSender` path rather than a separate ad-hoc SMTP call, so there's one email
  sending path, one delivery-status webhook, and one place bounce/complaint handling lives.

### WhatsApp channel (Meta Cloud API — official)

`Notification.Channel = "whatsapp"` rows are sent through **Meta's official WhatsApp Business
Cloud API** (`graph.facebook.com`) — no third-party BSP needed unless you outgrow the free
tier's rate limits.

- **Prerequisites (Meta side, one-time setup, not code):** a Meta Business Account, a WhatsApp
  Business App inside Meta for Developers, a verified sender phone number (`Phone Number ID`),
  a permanent **System User access token** (not the 24h test token), and every message
  template (booking confirmation, reminder, cancellation) pre-approved under **WhatsApp
  Manager → Message Templates**, since the Cloud API only allows free-form replies inside a
  customer-initiated 24-hour session — anything outside that window must use an approved
  template.
- **Config (`appsettings.json` keys, values from user-secrets / Key Vault, never committed):**
  ```json
  "WhatsApp": {
    "PhoneNumberId": "1234567890",
    "AccessToken": "EAAG...",          // permanent System User token
    "ApiVersion": "v21.0",
    "BusinessAccountId": "9876543210"
  }
  ```
- **`WhatsAppNotificationSender` (implements a shared `INotificationSender` alongside the
  email/SMS senders the `NotificationDispatchJob` already picks between by `Channel`):**
  ```csharp
  public class WhatsAppNotificationSender : INotificationSender
  {
      private readonly HttpClient _http; // base address https://graph.facebook.com/{ApiVersion}/
      private readonly WhatsAppOptions _opts;

      public async Task SendAsync(Notification notification, CancellationToken ct)
      {
          var payload = new
          {
              messaging_product = "whatsapp",
              to = notification.RecipientPhone,          // E.164 format, e.g. "923001234567"
              type = "template",
              template = new
              {
                  name = MapTypeToTemplateName(notification.Type, branch.NotificationLanguage), // "booking_confirmed" -> "booking_confirmed_en" / "_ur"
                  language = new { code = branch.NotificationLanguage }, // Branch.NotificationLanguage, never a hardcoded "en"
                  components = BuildTemplateComponents(notification) // booking date/time/venue as variables
              }
          };

          var res = await _http.PostAsJsonAsync($"{_opts.PhoneNumberId}/messages", payload, ct);
          res.EnsureSuccessStatusCode(); // non-2xx -> caller leaves Notification.Status = pending for retry

          var body = await res.Content.ReadFromJsonAsync<WhatsAppSendResponse>(ct);
          notification.ProviderMessageId = body!.Messages[0].Id; // for delivery-status correlation below
      }
  }
  ```
  Register `_http` via `IHttpClientFactory` with `Authorization: Bearer {AccessToken}` set once
  in `Program.cs` (`AddHttpClient<WhatsAppNotificationSender>(...).ConfigureHttpClient(...)`).

- **Delivery status webhook** — Meta calls back with `sent`/`delivered`/`read`/`failed` events:
  ```
  GET  /api/v1/webhooks/whatsapp   -> Meta's verification handshake (hub.verify_token challenge)
  POST /api/v1/webhooks/whatsapp   -> delivery/read status + inbound message events
  ```
  Verify the `X-Hub-Signature-256` header against your App Secret (HMAC-SHA256 of the raw body)
  before trusting the payload — same principle as the payment webhook in section 5, never act
  on an unverified webhook body. Match the incoming `message_id` to `Notification.ProviderMessageId`
  and update `Status`/`SentAt` accordingly.
- **Opt-in / consent:** only send WhatsApp notifications to members who've provided a phone
  number and consented to WhatsApp contact (a `Member.WhatsAppOptIn` flag) — Meta suspends
  senders who message numbers without an established relationship/consent.
- **Failure handling:** on a non-2xx response (invalid template params, un-opted-in recipient,
  rate limit), leave `Notification.Status = "pending"` and let `NotificationDispatchJob`'s next
  run retry it a bounded number of times before marking it `failed` — never let one bad message
  block the rest of the queue.

---

## 8. Local vs. production checklist

| | Local | Production |
|---|---|---|
| Database | SQL Server via Docker (`mcr.microsoft.com/mssql/server`) or LocalDB | Azure SQL / a managed SQL Server instance |
| Config | `appsettings.Development.json` (or user-secrets for the connection string) | `appsettings.Production.json` + environment variables / Key Vault |
| Migrations | `dotnet ef database update` | run the same migrations via CI/CD (`dotnet ef database update` in a release pipeline step) or apply at startup behind a feature flag |
| Payment providers | each `BranchPaymentProvider.CredentialsJson` holds sandbox creds (Stripe test keys, JazzCash/EasyPaisa/PayFast UAT merchant IDs) | same rows, switched to live credentials — encrypted via `IDataProtector` either way, never plaintext in appsettings.json |
| Tax / FBR | `Branch.TaxEnabled = false` or point `Fbr:BaseUrl` at FBR's sandbox | `Fbr:BaseUrl` set to FBR's production endpoint only after the branch's POS registration is verified |
| Background jobs | run in-process (`BackgroundService`) | same, or move to Hangfire with a dashboard once you need visibility into job history |

Keep the `BookingHub.Infrastructure/Migrations` folder committed so `dotnet ef database
update` against production is always applying exactly what you tested locally.

---

## 9. What the frontend currently expects from you

The frontend's `src/services/*.ts` mock layer defines the exact shapes it wants back
(organizations, branches, courts, availability slots, bookings, members, users, reports). When
your ASP.NET Core API is ready, replace each mock function body with a `fetch`/`axios` call to
the matching endpoint above — the component code does not need to change.
