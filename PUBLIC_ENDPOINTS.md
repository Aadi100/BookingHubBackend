# Public Discovery Endpoints (Catalog Browsing)

**Status:** ✅ Configured for public access  
**Updated:** October 1, 2026

---

## Public GET Endpoints (No Auth Required)

These endpoints are now configured to allow unauthenticated catalog browsing:

| Endpoint | Method | Purpose | Query Params |
|----------|--------|---------|--------------|
| `/branches` | GET | List all venues/branches | `organizationId=` (optional) |
| `/courts` | GET | List courts in a branch | `branchId=` (required) |
| `/rooms` | GET | List gaming rooms in a branch | `branchId=` (required) |
| `/seats` | GET | List seats in a room | `roomId=` (required) |
| `/packages` | GET | List available packages | `branchId=` (required) |
| `/availability` | GET | Check slot availability | `courtId=` or `roomId=`, `date=` (required) |

---

## Code Changes Made

All 6 functions updated to:
- ✅ Allow unauthenticated GET requests (catalog browsing)
- ✅ Keep POST/PATCH/DELETE protected (require authentication)
- ✅ Return only public data (active venues, open slots, etc.)

### Functions Modified:
```
supabase/functions/branches/index.ts
supabase/functions/courts/index.ts
supabase/functions/rooms/index.ts
supabase/functions/seats/index.ts
supabase/functions/packages/index.ts
supabase/functions/availability/index.ts
```

---

## Example Requests

### List all branches
```bash
curl "https://hfaghwlklnztmhijijuw.supabase.co/functions/v1/branches"
```

### Get courts in a branch
```bash
curl "https://hfaghwlklnztmhixixuw.supabase.co/functions/v1/courts?branchId=branch-uuid"
```

### Check availability
```bash
curl "https://hfaghwlklnztmhixixuw.supabase.co/functions/v1/availability?courtId=court-uuid&date=2026-10-05"
```

### Get gaming rooms
```bash
curl "https://hfaghwlklnztmhixixuw.supabase.co/functions/v1/rooms?branchId=branch-uuid"
```

### List packages
```bash
curl "https://hfaghwlklnztmhixixuw.supabase.co/functions/v1/packages?branchId=branch-uuid"
```

---

## Protected Endpoints (Still Require Auth)

These endpoints still require JWT authentication:

| Endpoint | Methods | Auth Required |
|----------|---------|---------------|
| `/bookings` | POST, PATCH, DELETE | ✅ Yes |
| `/packages/{id}/purchase` | POST | ✅ Yes |
| `/wallet` | GET, POST | ✅ Yes |
| `/payments-stripe/*` | POST | ✅ Yes |
| `/notifications/*` | POST | ✅ Yes |
| `/organizations` | POST, PATCH, DELETE | ✅ Yes (SuperAdmin only) |
| `/staff` | POST, PATCH, DELETE | ✅ Yes (Admin only) |
| `/courts`, `/rooms`, `/seats` | POST, PATCH, DELETE | ✅ Yes (Admin only) |

---

## Frontend Integration

Your React app can now browse the catalog without requiring user login:

```typescript
// No auth needed for browsing
const branches = await fetch(
  'https://hfaghwlklnztmhixixuw.supabase.co/functions/v1/branches'
).then(r => r.json())

// Auth required for booking/purchasing
const booking = await fetch(
  'https://hfaghwlklnztmhixixuw.supabase.co/functions/v1/bookings',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({...})
  }
).then(r => r.json())
```

---

## Deployment

✅ Functions deployed to Supabase  
✅ Code pushed to GitHub  
✅ Changes committed: `6d95a25`

---

## Security

✅ Read-only data exposed (no sensitive info)  
✅ Write operations still protected  
✅ User-specific data requires authentication  
✅ Admin operations require proper roles

---

**Base URL:** `https://hfaghwlklnztmhixixuw.supabase.co/functions/v1`  
**Region:** ap-southeast-1 (Singapore)  
**Status:** Production Ready ✅
