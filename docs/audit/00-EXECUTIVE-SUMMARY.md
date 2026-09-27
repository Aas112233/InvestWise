# InvestWise — Security & Correctness Audit

**Executive summary**
Date: 2026-09-27 · Scope: full live codebase (Next.js 15 App Router at repo root) · Mode: read-only, no source modified

---

## 1. Bottom line

The toolchain is green — `tsc --noEmit` passes, `next lint` reports zero warnings, and
**69/69 tests pass**. That is exactly why this audit was worth running: nothing here is a
type error or a lint error. Every defect below is a **semantic** one that a compiler cannot see,
and several of them are severe enough to be exploitable or financially material.

**This system must not process real money in its current state.** There is an unauthenticated
remote authentication bypass that reaches every API route, and a downloadable backup endpoint
that returns every tenant's data including password hashes.

There is also a governance-level problem that outranks any individual bug: **the entire live
application is not tracked in git** (see §5). Nothing below is protected by history.

---

## 2. The architectural root cause

`AGENTS.md` describes a migration from a Vite SPA (`client/`) + Express API (`server/src/`) to
Next.js 15 App Router. The migration is **half-finished in a dangerous way**: both
architectures are live at the same time, and they disagree.

```
app/api/finance/**        (13 routes)  ──▶  @/server/modules/finance/handlers   ← "legacy" but LIVE
app/api/funds/[id]        (PUT)        ──▶  @/server/modules/members/handlers   ← "legacy" but LIVE
app/api/deposits|dividends|expenses|transactions|funds/**                   ← new native handlers
```

`tsconfig.json:26-28` maps `@/server/*` → `./server/src/*`, so the "legacy" Express tree is
imported directly by Next.js route handlers. There are consequently **two parallel
implementations of the same money logic** — deposits, approvals, expenses, transactions — and
they do not agree. The finance audit found concrete divergence where the new
`app/api/deposits/[id]/approve` route is *less* safe than the `server/src` version it replaced
(TOCTOU on `status='PENDING'` allows the same payment to be credited twice).

Which behaviour a user gets depends on which endpoint the UI happens to call. That is not a
bug you can patch; it is a fork in the road that has to be resolved deliberately.

---

## 3. Critical findings

### C1 — Unauthenticated full takeover via client-supplied headers
`lib/middleware/auth.ts:452-481`

```ts
export async function getAuthContext(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  if (userId) {
    const role = normalizeRole(request.headers.get('x-user-role') || 'Member');
    const tenantId = request.headers.get('x-tenant-id');
    ...
    permissions = JSON.parse(request.headers.get('x-user-permissions') || '{}');
    return { user: { id: userId, tenantId, role, status: 'active', permissions, ... }, tenantId };
  }
  // ...real JWT verification only reached if the header is absent
}
```

`getAuthContext()` is the auth gate for the API. If the request carries an `x-user-id` header,
it returns a **fully-populated, `active` user with an attacker-chosen role, tenant and
permissions — with no JWT verification, no signature check, no database lookup, and no
blacklist check.**

Verified: **nothing anywhere in this repository ever sets these headers**, and `vercel.json`
is literally `{"framework": "nextjs"}` — no gateway, no rewrite, no header stripping. The
headers arrive straight from the internet.

Impact: an anonymous attacker sends
`x-user-id: <uuid>`, `x-user-role: SuperAdmin`, `x-tenant-id: <victim>` and is authenticated as
a platform superadmin on every one of the 67 API routes. This is a total compromise, reachable
in one HTTP request with no credentials.

This looks like a leftover "trusted internal gateway" path from the Express architecture. In
the Next.js deployment there is no gateway, so the trust boundary no longer exists.

### C2 — Unscoped backup download leaks every tenant, plus credentials
`app/api/backup/route.ts:13-21`, `:86-92`

```ts
const TABLES = ['members','transactions','projects','funds','users','system_settings',
  'audit_logs','login_attempts','sessions','deleted_records','blacklisted_tokens',
  'global_stats','goals'];

async function performBackup() {
  for (const table of TABLES) {
    backup[table] = await sql.unsafe(`SELECT * FROM ${table}`);   // no tenant filter
  }
}
```

`GET /api/backup?download=true` streams this as a downloadable JSON file. It is gated only by
"caller role is Admin or SuperAdmin" — and per **C1** that gate is bypassable by an anonymous
request. The payload includes `users` (**bcrypt password hashes**), `sessions` (live
`sessionId` values), `login_attempts` (IP addresses) and `blacklisted_tokens` (**raw, unexpired
JWTs** — see H3). One request yields credential material for the entire platform.

### C3 — Cross-tenant read *and* write on the financial ledger
`app/api/transactions/[id]/route.ts:54`, `:100`, `:118`

```ts
.where(eq(transactions.id, id))   // GET — no tenant predicate, no role check
...
.where(eq(transactions.id, id))   // DELETE (soft-delete) — no tenant predicate
```

Compare the correct pattern used elsewhere, `app/api/members/[id]/route.ts:42-47`, which applies
`tenantScope(user.tenantId)`. The transaction route omits it on both the read and the
destructive write. A **Manager in Tenant A can read and soft-delete financial transactions
belonging to Tenant B**, and the resulting audit entry does not record a tenant either.

### C4 — Financial data leaks across users on a shared browser
`lib/query-client.ts:5,15-20` + `lib/auth-context.tsx:100-112`

The TanStack Query client is a **module-level singleton** that is never cleared. Logout clears
`localStorage` and the in-memory user, but never calls `queryClient.clear()`. Meanwhile no query
key anywhere in the app is scoped to a user or tenant — they are literals like `["funds"]`,
`["members", "dropdown"]`, `["audit", ...]`, `["settings"]`:

```ts
let browserClient: QueryClient | undefined;
browserClient ??= new QueryClient({ defaultOptions: {
  queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } });
```

With `staleTime: 30_000` and `refetchOnWindowFocus: false`, the next person to sign in on a
shared or kiosk browser is served the **previous user's funds, members, transactions and audit
log from cache**, with no refetch. The same defect leaks across a tenant switch, and
`["settings"]` (with `refetchOnMount: false`) carries the prior tenant's currency and org name.

### C5 — Users are created with a NULL tenant, and NULL means "all tenants"
`app/api/auth/register/route.ts:125-137` + `app/api/members/[id]/route.ts:12-15`

The user-creation INSERT never sets `tenantId`. The column is nullable with no default
(`db/schema/users.ts:6`). Meanwhile the codebase's scoping helper **fails open**:

```ts
function tenantScope(tenantId: string | null) {
  if (!tenantId) return undefined;      // ← no tenant ⇒ NO scope applied
  return sql`${members.tenantId} = ${tenantId}`;
}
```

So every ordinary user created through the app's own "create user" screen is
**indistinguishable from a platform operator**: their tenant is null, therefore no tenant
filter is applied anywhere, therefore they can read and modify all tenants' data. The bug
manufactures its own trigger condition.

---

## 4. High findings

### H1 — Refresh-token rotation reuse detection is dead code
`db/schema/blacklisted_tokens.ts:13-16` + `app/api/auth/refresh/route.ts:82`

The refresh route defends against token replay by catching Postgres error `23505`
(unique_violation) when re-inserting a rotated token:

```ts
} catch (insertError: any) {
  if (insertError?.code === '23505') {
    throw new AuthError('Token has been revoked or already rotated', 'TOKEN_REVOKED');
  }
```

But the table declares **no unique constraint on `token`** — only indexes on `expires_at` and
`user_id`. The `23505` branch is therefore unreachable. Sequential replay is still caught by the
preceding SELECT, but two concurrent requests presenting the same token both pass that SELECT and
both insert successfully, minting two valid token pairs from one refresh token. The schema-level
guarantee the code assumes was never created.

### H2 — Money is mutated with float read-modify-write, and the read happens outside the transaction
`app/api/deposits/route.ts:243-244`, `app/api/deposits/[id]/approve/route.ts:91-100`,
`app/api/expenses/route.ts:206-208`

```ts
const fundBalance = parseFloat(fund.balance);          // read from a query made BEFORE the tx
const newFundBalance = (fundBalance + depositAmount).toFixed(2);
await tx.update(funds).set({ balance: newFundBalance, ... })
```

This violates the project's own mandatory rule in `AGENTS.md` ("NEVER use float money math").
Two consequences:

- **Lost update.** The balance is read outside the transaction and written back as an absolute
  value. Two concurrent deposits both read `1000.00`, both write `1000.00 + X` — one deposit
  vanishes from the fund balance while both are recorded in the ledger. The correct form is a
  SQL-side increment (`balance = balance + amount`), which is atomic by construction.
- **Wrong numbers in the API response.** `app/api/deposits/route.ts:306-307` and
  `approve/route.ts:145-146` recompute the new totals from the **stale pre-transaction** objects
  rather than the values actually committed, so the response can report a figure that is not in
  the database.

`analytics/analysis/route.ts:143-145` compounds this by deriving `net` from already-rounded
`inflow`/`outflow` values.

### H3 — Raw JWTs persisted in the database
`app/api/auth/logout/route.ts:40`, `refresh/route.ts:74`, `admin/impersonate/route.ts:86`

The in-memory blacklist deliberately stores `sha256(token)` — the comment says "never holds raw
tokens" — but the database column stores the **raw signed JWT**. Any read access to the database
(backup per C2, replica, SQL injection, an R2 backup artifact) yields immediately usable
credentials. Store the hash, look up by hash.

### H4 — Unvalidated mass assignment on a money write
`server/src/modules/members/handlers.ts:96-97`

```ts
const body = (await request.json()) as Record<string, unknown>;
const fund = await fundsService.updateFund(id, body as never);
```

`body as never` is a cast that exists specifically to defeat TypeScript's excess-property
checking. The raw request body is passed straight into a service update with no schema, so any
column the service happens to accept — including `tenantId` and balance fields — is
client-controllable.

### H5 — Logout does not actually clear the access-token cookie
`lib/utils/cookies.ts:22`, `:31`, `:36-41`

Cookies are set with explicit paths — access `path: '/'`, refresh `path: '/api/auth'` — but
`clearAuthCookies()` calls `cookies.delete(name)` **with no path**. Per RFC 6265 §5.3, a
Set-Cookie without a `Path` gets the default-path derived from the request URI, so a logout at
`/api/auth/logout` emits `Path=/api/auth`, which does not match the access cookie at `Path=/`.
Because the cookie is `HttpOnly`, client JavaScript cannot clean up after it. The session token
therefore survives logout in the browser until its 15-minute expiry. Server-side blacklisting
limits the damage, but "log out" does not mean what users believe it means.

### H6 — The dashboard fabricates financial figures when the API fails
`components/dashboard/*` (see `03-ui-ux.md`, UI-004)

On API failure the dashboard does not show an error — it renders **hardcoded placeholder values**
such as `Math.max(totalMembers, 502)`, a fixed `৳4,850,000` total, and a hardcoded
`"27/09/2026"` date. A financial dashboard that invents plausible-looking numbers on failure is
worse than one that shows nothing: the figures are indistinguishable from real ones, so a user
reporting a discrepancy is arguing with a constant. This pattern recurs across views — errors are
swallowed into empty tables and `৳0.00` KPI tiles rather than surfaced.

---

## 5. The finding that outranks the bugs

**The live application is not in git.**

```
git ls-files app lib db components   →  0 files
git ls-files (total)                 →  300 files
```

The 300 tracked files are the *old* architecture. Everything that actually runs today — the
Next.js app, the Drizzle schema, the components — exists only as untracked files on this
machine. Compounding it:

- `.gitignore:181` is `*.sql`, which excludes **every migration file**.
- `.gitignore:242` is `.env*`.
- 117 deletions (the old `client/`) sit **unstaged** in the working tree.

So: the schema is unversioned, the migrations are untracked, the code is untracked, and a
half-finished migration is one `git add -A` away from being committed as a broken tree. If this
disk is lost, the product is lost. Fix this before fixing anything else — it is a one-hour job
(commit the app, un-ignore migrations deliberately, commit the deletions as an intentional
migration commit) and it makes every other fix in this document recoverable.

Related, from the data-layer audit: **`drizzle-kit migrate` is currently a silent no-op.**
`db/migrations/` contains hand-written SQL with no `meta/_journal.json`, root `package.json`
exposes no `db:*` scripts, and no `CREATE TABLE` for the base tables exists anywhere. The
database is not reproducible from the repository. A fresh deploy would come up empty.

---

## 6. What is done right

Worth stating, so a remediation pass does not regress it:

- Access and refresh tokens are correctly `HttpOnly` + `Secure` in production + `SameSite=Strict`,
  and the refresh cookie is path-scoped to `/api/auth` so it is not sent on ordinary requests.
- JWTs are asymmetric-checked with pinned secrets; refresh uses a separate secret from access.
  Type confusion between access and refresh tokens is explicitly rejected (`lib/utils/jwt.ts:79`).
- `lib/permissions.ts` is a clean, pure, unit-tested permission model with sensible
  parent-screen inheritance, and it is shared between client and server.
- Soft delete with `deletedBy`/`deletionReason` plus audit logging is applied to transactions
  rather than hard deletes — the right instinct for a financial ledger.
- Deposit creation and approval are wrapped in `db.transaction(...)`; the atomicity is right even
  though the arithmetic inside is not.
- The legacy `server/src/middleware/api.ts` masks 500-level errors, while the new Next.js
  handlers return raw `err.message` to clients in ~15 routes — the older code is the better
  example to copy here.
- `lib/money.ts` and `lib/shares.test.ts` exist and are unit-tested; the pure-math layer is in
  good shape. The defects are concentrated in the route handlers that bypass it.

---

## 7. Recommended order of work

1. **Today** — Commit the app to git; stop ignoring migrations deliberately. (Recovery first.)
2. **Today** — Delete the `x-user-*` branch in `lib/middleware/auth.ts:452-481`. One deletion
   closes C1, C2 and most of the remaining Critical set. If an internal gateway is genuinely
   needed, it must be re-established as an explicit, verified trust boundary.
3. **Today** — Scope the backup query per tenant, and strip `users.password`,
   `sessions.sessionId`, `blacklisted_tokens` and login IPs from the payload.
4. **This week** — Add `queryClient.clear()` to logout and prefix every query key with the
   user/tenant id; delete the fabricated dashboard fallbacks so a failed fetch shows an error.
5. **This week** — Fix tenant scoping on `transactions/[id]`; set `tenantId` on user creation;
   change the tenant helper to **fail closed** (deny when `tenantId` is absent) rather than
   return `undefined`.
6. **This week** — Add the unique index on `blacklisted_tokens.token`; store token hashes, not
   raw JWTs; pass `path` in `clearAuthCookies`.
7. **This sprint** — Convert balance mutations to SQL-side atomic increments; derive API
   responses from committed values.
8. **This sprint** — Decide the finance architecture: one implementation, not two. The `server/src`
   finance service is the safer of the pair — port its locking semantics to the native handlers
   and then delete the duplicate path.
9. **Then** — Add the regression tests listed in the per-area reports. The green suite currently
   passes while all of the above are true, so the suite is not protecting you yet.

---

## 8. Where the detail is

| Report | Area | Findings |
|---|---|---|
| [`01-security-auth.md`](./01-security-auth.md) | AuthN/AuthZ, RBAC, tenant isolation, secrets, middleware | 26 — 9 Critical, 7 High, 8 Medium, 2 Low |
| [`02-finance-logic.md`](./02-finance-logic.md) | Money math, share accounting, transaction integrity, legacy drift | 30 — 7 Critical, 12 High, 8 Medium, 3 Low |
| [`03-ui-ux.md`](./03-ui-ux.md) | React correctness, data fetching, forms, i18n, a11y | 61 — 6 Critical, 18 High, 28 Medium, 9 Low |
| [`04-data-infra.md`](./04-data-infra.md) | Schema drift, migrations, secrets, CI/CD, backup surface, repo hygiene | 35 — 6 Critical, 10 High, 14 Medium, 5 Low |
| [`05-api-surface.md`](./05-api-surface.md) | HTTP contract, validation, error handling, auth flows | 52 — 8 Critical, 17 High, 18 Medium, 9 Low |
| **Total** | | **204 findings — 36 Critical, 64 High, 76 Medium, 28 Low** |

Findings overlap by design: the same defect is often reachable from two angles (e.g. the
`x-user-*` bypass is reported by both the security and API-surface passes). Treat the
Critical set as **~20 distinct root causes**, not 36 separate emergencies.

Every finding in those files carries a `path:line` reference and a quoted snippet. Items that
could not be confirmed are listed under **"Needs verification"** rather than asserted as fact —
in particular, production reachability of the `x-user-*` bypass, and whether the
`.env.example` credentials ever entered git history.
