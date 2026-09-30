# Booking Hub Backend — Getting Started

Your Supabase backend is now ready to go! Here's how to set it up and run it.

---

## 🚀 Quick Setup (5 minutes)

### 1. Create Supabase Project
```bash
# Go to https://supabase.com → create a new project
# Select PostgreSQL 15+
# Copy your Project URL and API Keys
```

### 2. Install Supabase CLI
```bash
npm install -g supabase
# or macOS
brew install supabase/tap/supabase
```

### 3. Link Your Project
```bash
cd C:\Users\Abdul Hadi\OneDrive\Desktop\Backend
supabase link --project-ref YOUR_PROJECT_REF
# (You can find YOUR_PROJECT_REF in Supabase dashboard URL)
```

### 4. Deploy Database Schema
```bash
# Push the migration to your project
supabase db push
```

### 5. Deploy Edge Functions
```bash
# Deploy all functions to Supabase
supabase functions deploy
```

### 6. Set Environment Variables
In Supabase Dashboard → Project Settings → Configuration:
```
STRIPE_SECRET_KEY=sk_test_...
RESEND_API_KEY=re_...
WHATSAPP_PHONE_NUMBER_ID=...
# (see supabase/.env.example for all)
```

**Done!** Your backend is live. ✅

---

## 🛠️ Local Development

### Start Local Supabase
```bash
# Terminal 1: Start Supabase locally
supabase start

# Output will show:
# API URL: http://localhost:54321
# Anon Key: eyJ...
# Service Role Key: eyJ...
```

### Run Migrations Locally
```bash
supabase db push
```

### Serve Edge Functions Locally
```bash
# Terminal 2: Serve Edge Functions (with hot reload)
supabase functions serve --no-verify-jwt

# Functions now available at:
# http://localhost:54321/functions/v1/auth
# http://localhost:54321/functions/v1/bookings
# http://localhost:54321/functions/v1/availability
# etc.
```

### Test an Edge Function
```bash
# Terminal 3: Test a booking
# First, sign up a member
curl -X POST http://localhost:54321/auth/v1/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "Test123!"}'

# Then sign in to get a token
TOKEN=$(curl -s -X POST http://localhost:54321/auth/v1/token?grant_type=password \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "Test123!"}' | jq -r '.access_token')

# Now test an endpoint
curl -X GET "http://localhost:54321/functions/v1/availability?courtId=uuid&date=2024-02-01" \
  -H "Authorization: Bearer $TOKEN"
```

---

## 📁 Project Structure

```
Backend/
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql      ← Database schema
│   ├── functions/
│   │   ├── auth/index.ts               ← Member registration, staff creation
│   │   ├── bookings/index.ts           ← Create/cancel bookings
│   │   ├── availability/index.ts       ← Slot availability
│   │   ├── courts/index.ts             ← Court CRUD
│   │   └── wallet/index.ts             ← Wallet balance, credits, debits
│   ├── .env.example                    ← Copy to .env.local
│   └── config.toml                     ← Local dev config
│
├── BACKEND_SPEC.md                     ← Full specification
├── EDGE_FUNCTIONS_TEMPLATE.md          ← Code patterns
├── SUPABASE_QUICK_START.md             ← Setup guide
├── README.md                           ← Overview
└── GETTING_STARTED.md                  ← This file
```

---

## 🔑 Environment Variables

### Local Development
Create `supabase/.env.local`:
```bash
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=eyJ...  (from supabase start output)
SUPABASE_SERVICE_ROLE_KEY=eyJ...  (from supabase start output)
```

### Production (Supabase Dashboard)
Project Settings → Configuration:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
STRIPE_SECRET_KEY=sk_live_...
RESEND_API_KEY=re_...
# etc.
```

---

## 📊 Database

### Check Schema
```bash
# In Supabase dashboard → Table Editor
# Or via psql:
psql postgresql://postgres:password@localhost:5432/postgres
\dt  # List tables
\d bookings  # Describe a table
```

### Seed Test Data
```bash
# Create supabase/seed.sql with test organizations/branches/courts
# Then run:
supabase db push --dry-run
```

---

## 🧪 Testing Edge Functions

### Test Auth (Register Member)
```bash
curl -X POST http://localhost:54321/functions/v1/auth/members/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "password": "SecurePass123!"
  }'
```

### Test Bookings (Create)
```bash
curl -X POST http://localhost:54321/functions/v1/bookings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "branch_id": "uuid",
    "court_id": "uuid",
    "start_time": "2024-02-01T10:00:00Z",
    "end_time": "2024-02-01T11:00:00Z",
    "payment_method": "Card",
    "price": 5000
  }'
```

### Test Availability
```bash
curl "http://localhost:54321/functions/v1/availability?courtId=uuid&date=2024-02-01" \
  -H "Authorization: Bearer $TOKEN"
```

### View Function Logs
```bash
# Terminal where supabase functions serve is running
# Or in Supabase dashboard → Functions → Logs
```

---

## 🚨 Common Issues

### "Port 54321 already in use"
```bash
# Kill the process using it:
lsof -i :54321
kill -9 <PID>
# Or change port in supabase/config.toml
```

### "JWT verification failed"
When testing locally without real JWT:
```bash
# Use --no-verify-jwt flag:
supabase functions serve --no-verify-jwt
```

### "Function not found"
```bash
# Make sure function file exists and is deployed:
supabase functions list
supabase functions deploy
```

### "Database connection refused"
```bash
# Start Supabase first:
supabase start
# Wait a few seconds for postgres to be ready
```

---

## 📝 Next Steps

### 1. Implement Missing Edge Functions
From EDGE_FUNCTIONS_TEMPLATE.md, create:
- `payments/` — Payment intents, webhooks
- `packages/` — Package CRUD, purchase
- `rooms/` — Room CRUD (similar to courts/)
- `notifications/` — Email/WhatsApp sending
- `staff/` — Staff CRUD

### 2. Set Up Stripe (Minimum Payment)
```bash
# Get Stripe test keys from https://dashboard.stripe.com
# Add to environment variables:
# STRIPE_SECRET_KEY=sk_test_...
# STRIPE_PUBLISHABLE_KEY=pk_test_...

# Then implement supabase/functions/payments/stripe.ts
```

### 3. Connect Frontend
In your React app (`src/services/bookingService.ts`):
```typescript
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_KEY = process.env.REACT_APP_SUPABASE_KEY;

export async function createBooking(req: CreateBookingRequest) {
  const token = localStorage.getItem('auth_token');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/bookings`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(req)
  });
  return await response.json();
}
```

### 4. Deploy to Production
```bash
# Push schema to production
supabase db push

# Deploy Edge Functions
supabase functions deploy

# Verify in Supabase dashboard
```

---

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| **BACKEND_SPEC.md** | Complete design (read for understanding) |
| **EDGE_FUNCTIONS_TEMPLATE.md** | Code patterns (copy-paste as you build) |
| **SUPABASE_QUICK_START.md** | Initial setup guide |
| **SUPABASE_MIGRATION.md** | ASP.NET → Supabase migration info |
| **README.md** | Architecture overview |
| **DOCUMENTATION_INDEX.md** | How to find things |
| **GETTING_STARTED.md** | This file (setup & running) |

---

## 🎯 API Endpoints (Quick Reference)

All endpoints under: `https://your-project.supabase.co/functions/v1/`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/auth/members/register` | Member registration |
| POST | `/auth/staff/create` | Staff creation (admin only) |
| GET | `/availability?courtId=...&date=...` | Slot availability |
| POST | `/bookings` | Create booking |
| GET | `/bookings?status=...&courtId=...` | List user's bookings |
| PATCH | `/bookings/{id}/cancel` | Cancel booking |
| GET | `/courts?branchId=...` | List courts |
| POST | `/courts` | Create court (admin only) |
| PATCH | `/courts/{id}` | Update court (admin only) |
| DELETE | `/courts/{id}` | Delete court (admin only) |
| GET | `/wallet` | Get wallet balance |
| GET | `/wallet/credits` | Get wallet recharge history |
| GET | `/wallet/debits` | Get booking payment history |
| POST | `/wallet/recharge` | Top up wallet |

See BACKEND_SPEC.md Section 5 for complete list.

---

## 💬 Support

- **Supabase Docs:** https://supabase.com/docs
- **Edge Functions:** https://supabase.com/docs/guides/functions
- **This Backend:** BACKEND_SPEC.md

---

**Ready to go!** 🚀

Next: `supabase start` → `supabase functions serve` → test away!

