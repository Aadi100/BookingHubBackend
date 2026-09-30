-- ============================================================================
-- Booking Hub — Initial Database Schema for Supabase
-- ============================================================================
-- Run this migration via: supabase db push
-- Or paste into Supabase SQL Editor → Run
-- ============================================================================

-- Organizations
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    ntn_number TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Branches
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    name TEXT NOT NULL,
    venue_type TEXT NOT NULL CHECK (venue_type IN ('Court', 'Zone')),
    location TEXT,
    description TEXT,
    amenities TEXT[] DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',

    tax_enabled BOOLEAN DEFAULT FALSE,
    tax_rate_percent NUMERIC(5,2) DEFAULT 0,
    fbr_pos_registration_number TEXT,

    default_currency TEXT DEFAULT 'PKR',
    notification_language TEXT DEFAULT 'en',
    card_payment_timeout_minutes INT DEFAULT 10,
    no_show_grace_minutes INT DEFAULT 15,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_branches_organization_id ON branches(organization_id);

-- Courts (for court venues)
CREATE TABLE courts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    name TEXT NOT NULL,
    sport_type TEXT NOT NULL,
    capacity INT DEFAULT 1,
    hourly_rate NUMERIC(10,2) NOT NULL,
    amenities TEXT[] DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_courts_branch_id ON courts(branch_id);

-- Court Schedules
CREATE TABLE court_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    court_id UUID NOT NULL REFERENCES courts(id),
    day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    open_time TIME NOT NULL,
    close_time TIME NOT NULL,
    slot_minutes INT DEFAULT 60,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_court_schedules_court_id ON court_schedules(court_id);

-- Court Exceptions
CREATE TABLE court_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    court_id UUID NOT NULL REFERENCES courts(id),
    date DATE NOT NULL,
    is_closed BOOLEAN DEFAULT FALSE,
    open_time TIME,
    close_time TIME,
    price_override NUMERIC(10,2),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_court_exceptions_court_id ON court_exceptions(court_id);
CREATE INDEX idx_court_exceptions_date ON court_exceptions(date);

-- Rooms (for zone venues)
CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    name TEXT NOT NULL,
    game_type TEXT NOT NULL,
    capacity INT NOT NULL,
    booking_mode TEXT NOT NULL CHECK (booking_mode IN ('WholeRoom', 'PerSeat')),
    hourly_rate NUMERIC(10,2) NOT NULL,
    amenities TEXT[] DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rooms_branch_id ON rooms(branch_id);

-- Seats (for PerSeat booking mode)
CREATE TABLE seats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id),
    label TEXT NOT NULL,
    hourly_rate NUMERIC(10,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_seats_room_id ON seats(room_id);

-- Room Schedules
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

-- Room Exceptions
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

-- Packages
CREATE TABLE packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    scope TEXT NOT NULL CHECK (scope IN ('Court', 'Room', 'Seat', 'Branch')),
    scope_id UUID,
    name TEXT NOT NULL,
    package_type TEXT NOT NULL CHECK (package_type IN ('FixedSessions', 'BundleHours', 'UnlimitedMonthly', 'DiscountPercent')),
    sessions_included INT,
    hours_included NUMERIC(10,2),
    discount_percent NUMERIC(5,2),
    valid_days INT NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_packages_branch_id ON packages(branch_id);
CREATE INDEX idx_packages_scope_id ON packages(scope_id);

-- Members (1:1 with auth.users)
CREATE TABLE members (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    preferred_language TEXT DEFAULT 'en',
    email_opt_in BOOLEAN DEFAULT TRUE,
    whatsapp_opt_in BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Wallets
CREATE TABLE wallets (
    member_id UUID PRIMARY KEY REFERENCES members(id),
    balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
    currency TEXT NOT NULL DEFAULT 'PKR',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Member Packages
CREATE TABLE member_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES members(id),
    package_id UUID NOT NULL REFERENCES packages(id),
    sessions_remaining INT,
    hours_remaining NUMERIC(10,2),
    purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_member_packages_member_id ON member_packages(member_id);
CREATE INDEX idx_member_packages_package_id ON member_packages(package_id);

-- Wallet Credits
CREATE TABLE wallet_credits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES members(id),
    reason TEXT NOT NULL CHECK (reason IN ('Recharge', 'Refund', 'ManualAdjustment')),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    balance_after NUMERIC(12,2) NOT NULL,
    reference TEXT NOT NULL,
    payment_id UUID,
    booking_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallet_credits_member_id ON wallet_credits(member_id);
CREATE INDEX idx_wallet_credits_created_at ON wallet_credits(created_at);

-- Wallet Debits
CREATE TABLE wallet_debits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES members(id),
    reason TEXT NOT NULL CHECK (reason IN ('BookingPayment', 'PackagePurchase', 'ManualAdjustment')),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    balance_after NUMERIC(12,2) NOT NULL,
    reference TEXT NOT NULL,
    booking_id UUID,
    member_package_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallet_debits_member_id ON wallet_debits(member_id);
CREATE INDEX idx_wallet_debits_created_at ON wallet_debits(created_at);

-- Staff Profiles (1:1 with auth.users)
CREATE TABLE staff_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('SuperAdmin', 'OrgAdmin', 'BranchManager', 'Staff', 'Support')),
    organization_id UUID REFERENCES organizations(id),
    branch_id UUID REFERENCES branches(id),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_staff_profiles_organization_id ON staff_profiles(organization_id);
CREATE INDEX idx_staff_profiles_branch_id ON staff_profiles(branch_id);

-- Bookings (core transactional record)
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

    price NUMERIC(10,2) NOT NULL DEFAULT 0,
    tax_rate_percent NUMERIC(5,2) DEFAULT 0,
    tax_amount NUMERIC(10,2) DEFAULT 0,
    total NUMERIC(10,2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'PKR',

    fbr_invoice_number TEXT,
    fbr_qr_code TEXT,

    created_by_staff_id UUID REFERENCES staff_profiles(id),
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

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

-- Double-booking prevention indices
CREATE UNIQUE INDEX ux_booking_court_slot ON bookings(court_id, start_time)
    WHERE court_id IS NOT NULL AND status IN ('Pending', 'Confirmed');
CREATE UNIQUE INDEX ux_booking_room_slot ON bookings(room_id, start_time)
    WHERE room_id IS NOT NULL AND status IN ('Pending', 'Confirmed');
CREATE UNIQUE INDEX ux_booking_seat_slot ON bookings(seat_id, start_time)
    WHERE seat_id IS NOT NULL AND status IN ('Pending', 'Confirmed');

-- Payments
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID REFERENCES bookings(id),
    member_package_id UUID REFERENCES member_packages(id),
    purpose TEXT NOT NULL DEFAULT 'booking' CHECK (purpose IN ('booking', 'package_purchase', 'wallet_recharge')),
    amount NUMERIC(10,2) NOT NULL,
    tax_amount NUMERIC(10,2) DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'PKR',
    provider TEXT NOT NULL,
    provider_ref TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_booking_id ON payments(booking_id);
CREATE INDEX idx_payments_member_package_id ON payments(member_package_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_provider ON payments(provider);

-- Branch Payment Providers
CREATE TABLE branch_payment_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    provider_type TEXT NOT NULL CHECK (provider_type IN ('Stripe', 'JazzCash', 'EasyPaisa', 'PayFast', 'Cash', 'Wallet')),
    is_enabled BOOLEAN DEFAULT FALSE,
    is_default BOOLEAN DEFAULT FALSE,
    credentials_json TEXT NOT NULL DEFAULT '{}',
    currency TEXT DEFAULT 'PKR',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_branch_payment_providers_branch_id ON branch_payment_providers(branch_id);

-- Notifications
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID REFERENCES members(id),
    staff_id UUID REFERENCES staff_profiles(id),
    booking_id UUID REFERENCES bookings(id),
    channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp', 'push')),
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'delivered')),
    provider_message_id TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_member_id ON notifications(member_id);
CREATE INDEX idx_notifications_staff_id ON notifications(staff_id);
CREATE INDEX idx_notifications_status ON notifications(status);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);

-- Translations (i18n)
CREATE TABLE translations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    field_name TEXT NOT NULL,
    language_code TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(entity_type, entity_id, field_name, language_code)
);

CREATE INDEX idx_translations_entity ON translations(entity_type, entity_id);
CREATE INDEX idx_translations_language ON translations(language_code);

-- ============================================================================
-- Row-Level Security (RLS) Policies
-- ============================================================================

-- Members: users see only their own profile
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
CREATE POLICY members_self_access ON members
    FOR ALL USING (id = auth.uid());

-- Staff: users see only their own profile
ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_self_access ON staff_profiles
    FOR ALL USING (id = auth.uid());

-- Bookings: members see only their own bookings
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY bookings_member_access ON bookings
    FOR SELECT USING (member_id = auth.uid());

-- Wallets: members see only their own wallet
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallets_member_access ON wallets
    FOR SELECT USING (member_id = auth.uid());

-- Wallet credits/debits: members see only their own
ALTER TABLE wallet_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallet_credits_member_access ON wallet_credits
    FOR SELECT USING (member_id = auth.uid());

ALTER TABLE wallet_debits ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallet_debits_member_access ON wallet_debits
    FOR SELECT USING (member_id = auth.uid());

-- ============================================================================
-- Schema is complete!
-- ============================================================================
