# Security & Authorization Logic

How identity, authentication, and authorization actually work across this
backend — end to end, as implemented (not aspirational). This traces one
request from JWT to database row so the links between layers are explicit.

---

## 1. The three layers, and where each one lives

| Layer | Enforces | Lives in |
|---|---|---|
| **Platform gateway** | "Is there a valid Supabase API key/JWT on this request at all?" | Supabase infra, before your code runs |
| **Edge function code** | "Is this specific user allowed to do this specific thing?" (role checks) | `supabase/functions/*/index.ts` |
| **Row-Level Security (RLS)** | "Can this Postgres role see/touch this row?" | `supabase/migrations/*.sql` |

A request has to pass all three. Most bugs found in this project (see git
history) came from layer 2 code accidentally tripping over layer 3 — a
function using the **anon-key client** to read a row that RLS only grants
to its owner, so it couldn't even read its own user's data. The fix
pattern used throughout: **auth with the anon client, then re-query with
a service-role client once identity is confirmed.** See §4.

---

## 2. Identity: how a request becomes a `user`

Every protected function does the same three lines first:

```ts
const authHeader = req.headers.get("Authorization") ?? "";
const token = authHeader.replace("Bearer ", "");
const { data: { user }, error } = await supabase.auth.getUser(token);
if (error || !user) return errorResponse("Unauthorized", 401, headers);
```

`supabase.auth.getUser(token)` validates the JWT signature against
Supabase Auth and returns the `auth.users` row it belongs to. `user.id`
is the UUID used everywhere downstream — it's the same id as
`members.id` / `staff_profiles.id` (see §3) and `auth.uid()` inside RLS
policies.

**Public endpoints** (`members/register`, `members/login`,
`staff/login`, `password/forgot`, `password/reset`, and all GET
discovery endpoints — branches/courts/rooms/seats/packages/availability)
skip this check entirely and run before it in the route table. Everything
else requires it.

**Platform-level gotcha:** Supabase's gateway itself requires *some*
bearer token on every Edge Function call — even public ones — or it
rejects with `401 Missing authorization header` before your code ever
runs. For public endpoints, callers pass the **anon key** as the bearer
token (not a user JWT). The anon key identifies "an app calling
publicly," not a user; `getUser()` on it returns no user, which is why
public handlers never call `getUser()` at all.

---

## 3. Two identity tables, one `auth.users` id

There is no single "users" table with a role column. Identity splits
into two profile tables, both keyed by `auth.users.id`:

- **`members`** — end customers booking courts/rooms. Created automatically.
- **`staff_profiles`** — org/branch employees. Created explicitly via
  `POST /staff` or `POST /auth/staff/create` by an existing `SuperAdmin`/`OrgAdmin`.

A given `auth.users.id` normally has a row in exactly one of these.
`GET /auth/me` checks `members` first, falls back to `staff_profiles`,
and returns `type: "unknown"` if neither exists (shouldn't happen for
any properly onboarded account — see §5 for the trigger that guarantees it
for members).

### Staff role hierarchy (`staff_profiles.role`)

```
SuperAdmin    — sees/manages everything, all orgs, all branches
  └─ OrgAdmin    — scoped to one organization_id; manages its branches/staff
       └─ BranchManager — scoped to one branch_id; manages that branch's venues/staff
            Staff, Support — same branch scope as BranchManager, no elevated actions
```

This hierarchy is **not enforced by a database constraint** — it's
re-implemented as an `if/else` in every function that needs it
(`staff`, `branches`, `courts`, `rooms`, `seats`, `packages`,
`organizations`, `auth` staff-create, `audit-logs`). The repeated shape:

```ts
if (userStaff.role === "SuperAdmin") {
  // no restriction, optionally filter by explicit org/branch param
} else if (userStaff.role === "OrgAdmin") {
  // default to own organization_id; reject if a different org is requested
} else {
  // BranchManager/Staff/Support — default to own branch_id; reject if a
  // different branch is requested
}
```

The "default to own scope, reject only on an explicit mismatch" shape
matters: an earlier version required the caller to always pass their own
`branchId`/`organizationId` explicitly, which rejected a plain
`GET /staff` from a legitimately authenticated BranchManager. Any new
staff-scoped endpoint should copy this shape, not the old one.

---

## 4. The service-role bypass pattern — and why it's safe here

Several functions (`auth` → `getMe`/`sessions`, `staff` → `listStaff`,
`wallet` → all handlers) create a **second** Supabase client using
`SUPABASE_SERVICE_ROLE_KEY` instead of the anon key, after already
authenticating the caller with `getUser()`:

```ts
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const { data } = await supabaseAdmin.from("wallets").select("*").eq("member_id", user.id).single();
```

**Why this exists:** RLS policies like `wallets_member_access` grant
access via `auth.uid() = member_id`. But `auth.uid()` only resolves
inside a Postgres session that Supabase's REST/client layer has attached
the user's JWT to. A server-side Edge Function using the anon-key client
is *not* automatically "logged in as" the user whose JWT it validated in
application code — `getUser(token)` just decodes and verifies the token,
it doesn't propagate an auth context to subsequent `.from()` calls on
that same client. The practical effect: querying a user's own row
through the anon client can return zero rows, indistinguishable from the
row not existing. This caused real bugs (`/auth/me` → `profile: null`,
`/wallet` → `404 Wallet not found`) against data that was actually
present.

**Why bypassing RLS here is still safe:** every one of these queries is
hand-scoped in code with `.eq("id", user.id)` /
`.eq("member_id", user.id)`, using the `user.id` that `getUser()` already
cryptographically verified. The service-role client isn't given
caller-controlled filters — it's always "this exact verified user's own
row." RLS is redundant in these specific call sites, not bypassed in a
way that widens access.

**Rule for new code:** if a handler needs to read/write a row scoped to
`auth.uid()`, use the service-role client *and* hand-written
`.eq(..., user.id)` filters — don't rely on the anon client plus RLS to
do it implicitly, and don't use the service-role client with a
caller-supplied id without a role check (that *would* be a privilege
escalation — see `members/index.ts`'s `getMember`/`updateMember`, which
explicitly check `if (memberId !== user.id) return 403` before touching
anything, precisely because `/members/{id}` takes an arbitrary id from
the URL).

---

## 5. Auto-provisioning trigger (`handle_new_member`)

`supabase/migrations/004_auto_create_members_and_wallet.sql` attaches a
Postgres trigger to `auth.users`:

```sql
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_member();
```

On every new signup (`members/register`, or any `auth.users` insert via
the admin API), this function — running as `security definer`, so it
runs with the privileges of the function owner regardless of RLS —
inserts:
1. a `members` row (name from `raw_user_meta_data->>'full_name'`,
   falling back to the email's local part)
2. a `wallets` row with `balance = 0, currency = 'PKR'`

This is what guarantees `GET /auth/me` and `GET /wallet` never 404 for a
real signup. It does **not** apply to `staff_profiles` — staff accounts
are provisioned explicitly (§3), not via this trigger, so creating a
staff `auth.users` row still requires a separate `staff_profiles` insert
(see `staff/index.ts` → `createStaff`, which does both in one call using
the service-role client).

---

## 6. RLS policy inventory (what's actually enabled)

| Table | Policy | Rule |
|---|---|---|
| `members` | `members_self_access`, `Members can view/update their own profile` | `auth.uid() = id` |
| `staff_profiles` | `staff_self_access` | `auth.uid() = id` |
| `bookings` | `bookings_member_access` | `auth.uid() = member_id` |
| `wallets` | `wallets_member_access` | `auth.uid() = member_id` |
| `wallet_credits` / `wallet_debits` | `*_member_access` | `auth.uid() = member_id` |
| `notifications` | `Users can view/update/delete their own notifications` | `auth.uid() = user_id` |
| `member_packages` | `member_packages_member_access` | `auth.uid() = member_id` |
| `audit_logs` | `audit_logs_read` (SELECT), `audit_logs_insert` (INSERT) | any `authenticated` role can read; insert requires `user_id = auth.uid()` |
| `organizations`, `branches`, `courts`, `rooms`, `seats`, `packages`, `court_schedules`, `room_schedules` | `*_public_read` | **unauthenticated SELECT allowed** — these are the discovery/browse endpoints, intentionally public |

Everything not listed has RLS **disabled** or no policy, which in
Postgres means the service-role key can always reach it but the anon
key gets nothing back — relevant if you add a new table and forget this
step; it'll silently return empty results via the anon client instead of
erroring, which is exactly the bug class in §4.

**Audit logs read policy is currently permissive** (`using (true)` for
any authenticated user, not staff-only) — the code comment in the
migration flags this as intentional-for-now ("tighten later to
staff-only"). If `/audit-logs` needs to be staff-only, that's an RLS
change, not an edge-function change — the `GET` handler in
`audit-logs/index.ts` doesn't itself check role, it relies on this
policy.

---

## 7. Request walkthrough: `GET /wallet` as `ahmed@test.com`

1. Frontend sends `Authorization: Bearer <ahmed's JWT>`.
2. Supabase gateway sees a syntactically valid bearer token, lets the
   request through to the `wallet` function.
3. `wallet/index.ts` creates an anon-key client, calls
   `supabase.auth.getUser(token)` → resolves to `user.id = 62419d5a-...`.
4. A second, service-role client is created (§4).
5. `getWallet(user.id, supabaseAdmin, ...)` runs
   `supabaseAdmin.from("wallets").select("*").eq("member_id", user.id).single()`.
6. Row exists because the `handle_new_member` trigger (§5) created it at
   signup. Returns `200 { member_id, balance: 0, currency: "PKR", ... }`.

Nothing in this path trusts a client-supplied id — `member_id` is always
derived from the verified JWT, never from a query param or body field.
Compare to `GET /members/{id}`, where the id *is* client-supplied (it's
in the URL) and the function has to explicitly check it matches
`user.id` before using it.

---

## 8. Known gaps (accurate as of last audit, not aspirational)

- **SMTP is not configured.** Supabase's default email sending has a
  strict dev-only rate limit. `/auth/password/forgot` and repeated fresh
  signups hit `400 email rate limit exceeded` until a real provider
  (Resend/SendGrid/Postmark) is wired up in **Dashboard → Authentication
  → Settings → SMTP**. This cannot be fixed from application code.
- **`audit_logs` SELECT policy is "any authenticated user," not
  staff-only** (§6) — tighten if audit data shouldn't be visible to
  members.
- **No rate limiting / brute-force protection** on login endpoints
  beyond whatever Supabase Auth does by default.
- **Staff role hierarchy is duplicated per-function**, not centralized
  — a bug fixed in one function's role-check (e.g. `staff/index.ts`)
  does not automatically fix the same bug shape in another
  (`branches`, `courts`, `rooms`, `seats`, `packages` all re-implement
  it separately). Audit all of them if the hierarchy ever changes.
