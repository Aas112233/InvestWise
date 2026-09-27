# Audit 01 — Security, Auth, RBAC & Tenant Isolation

Scope: ~108 files reviewed (67 × `app/api/**/route.ts`, `middleware.ts`, 16 × `lib/**` auth/RBAC files, 9 × `app/admin/**` pages, 8 × delegated `server/src/**` files reached from route handlers, 8 × `db/schema/**` files). Baseline: `tsc --noEmit` / `next lint` / vitest 69/69 green. READ-ONLY audit — no source file was modified.

> **Headline:** the codebase has *two* independent auth stacks and *two* independent tenancy models. The `lib/` stack (used by the Next.js-native routes) is decent; the `server/src/` stack (used by every `/api/finance/*`, `/api/funds/*`, `/api/projects` route) skips revocation. Separately, a large share of `app/api/**` handlers never call `requireTenant` at all, so a single `:id` from the URL reaches any tenant's row.

## Summary

| Severity | Count |
|---|---|
| Critical | 9 |
| High | 7 |
| Medium | 8 |
| Low | 2 |
| **Total** | **26** |

---

## AuthN / AuthZ endpoint matrix

Legend — Guard: `JWT` = `getAuthContext`/`requireAuthUser`/`getSessionUser`; Role: `perm` = screen-permission, `role` = role string compare; Tenant: `Y` = scoped, `F` = **fail-open** ternary, `N` = **not scoped**.

### Auth (`app/api/auth/**`) — all reachable without middleware auth

| Route | Method(s) | Guard found | Role check | Tenant scoped | Verdict |
|---|---|---|---|---|---|
| `/api/auth/login` | POST | none (public) | n/a | n/a | Lockout per-email only; user enumeration (SEV-013) |
| `/api/auth/refresh` | POST | JWT verify (refresh secret) | n/a | user row | Rotation + reuse detect OK; no rate limit (SEV-013) |
| `/api/auth/register` | POST | JWT | Admin/SuperAdmin | **N** | Creates users with NULL tenantId (SEV-005) |
| `/api/auth/me` | JWT | self-scoped | Y (own row) | OK |
| `/api/auth/sessions` | GET | JWT | self | Y (`eq(sessions.userId,…)`) | OK |
| `/api/auth/sessions/[sessionId]` | DELETE | JWT | self | Y (userId+sessionId) | OK |
| `/api/auth/logout` | POST | JWT | n/a | self | Refresh cookie not cleared (SEV-014) |
| `/api/auth/logout-all` | POST | JWT | n/a | Y | Ends DB sessions only; does **not** blacklist tokens (SEV-010) |
| `/api/auth/profile/password` | PUT | JWT | self | Y | No session/token invalidation (SEV-016) |
| `/api/auth/forgot-password` | POST | none (public) | n/a | n/a | No reset token is ever issued (SEV-016) |
| `/api/auth/login-history` | GET | JWT | self | Y | OK |
| `/api/auth/users` | GET | JWT | Admin/Manager/SA | **N** | Leaks all tenants' users (SEV-007) |

### Platform admin (`app/api/admin/**`) — correctly fenced

| Route | Method(s) | Guard found | Role check | Tenant scoped | Verdict |
|---|---|---|---|---|---|
| `/api/admin/tenants` | GET | `requireAuthUser` | `requireSuperAdmin` | platform | OK |
| `/api/admin/tenants/[id]` | PATCH, DELETE | `requireAuthUser` | `requireSuperAdmin` | platform | OK (default-tenant fenced) |
| `/api/admin/tenants/onboard` | POST | `requireAuthUser` | `requireSuperAdmin` | platform | OK |
| `/api/admin/billing` | GET, POST | `requireAuthUser` | `requireSuperAdmin` | platform | OK |
| `/api/admin/impersonate` | POST, DELETE | `requireAuthUser` | `requireSuperAdmin` | platform | Guard sound; see SEV-021 |

### Money / finance — mixed

| Route | Method(s) | Guard found | Role check | Tenant scoped | Verdict |
|---|---|---|---|---|---|
| `/api/deposits` | GET, POST | JWT | perm DEPOSITS | **F** | Fail-open (SEV-005) |
| `/api/deposits/[id]/approve` | POST | JWT | perm DEPOSITS | Y | OK — fund/member re-verified |
| `/api/deposits/[id]/reject` | POST | JWT | perm DEPOSITS | Y | OK |
| `/api/deposits/request` | POST | JWT | perm REQUEST_DEPOSIT | **F** | Fail-open (SEV-005) |
| `/api/expenses` | GET, POST | JWT | perm EXPENSES | **F** | Fail-open (SEV-005) |
| `/api/transactions` | GET, POST | JWT | perm | **F** | Fail-open (SEV-005) |
| `/api/transactions/[id]` | GET, DELETE | JWT | role Admin/Manager/SA | **N** | Cross-tenant read + soft-delete (SEV-011) |
| `/api/dividends/calculate` | POST | JWT | perm DIVIDENDS R | **F** | Fail-open (SEV-005) |
| `/api/dividends/distribute` | POST | JWT | perm DIVIDENDS W | **F** | Fail-open (SEV-005) |
| `/api/funds` | GET, POST | `getSessionUser` | perm FUNDS_MGMT | Y (list) | Create writes NULL tenantId (SEV-023) |
| `/api/funds/[id]` | PUT | `getSessionUser` | perm FUNDS_MGMT | **N** | Cross-tenant write IDOR (SEV-003) |
| `/api/funds/transfer` | POST | `getSessionUser` | perm FUNDS_MGMT | **F** | Fail-open (SEV-005) |
| `/api/finance/*` (10 routes) | GET/POST/DELETE | `getSessionUser` | perm | **F** | Service is tenant-scoped, but no revocation (SEV-010) + fail-open (SEV-005) |
| `/api/governance/penalties` | GET, POST | JWT | — | **N** | All tenants' penalties (SEV-011) |
| `/api/governance/penalties/[id]/waive` | POST | JWT | role Admin/Manager/SA | **N** | Cross-tenant money credit (SEV-006) |
| `/api/governance/rules` | GET | JWT | none | **N** | Global settings (SEV-004) |

### Business data — mostly unscoped

| Route | Method(s) | Guard found | Role check | Tenant scoped | Verdict |
|---|---|---|---|---|---|
| `/api/members` | GET, POST | `getSessionUser`/JWT | perm MEMBERS | Y | Member-code gen unscoped (SEV-023) |
| `/api/members/[id]` | GET, PUT, DELETE | JWT | perm MEMBERS | Y | `members.role` unvalidated (SEV-020) |
| `/api/projects` | GET | `getSessionUser` | **none** | **N** | All tenants' projects (SEV-002) |
| `/api/projects/[id]` | GET, PUT, DELETE | JWT | role / non-Member | **N** | IDOR (SEV-011) |
| `/api/projects/[id]/updates` | POST | JWT | non-Member | **N** | Cross-tenant balance write (SEV-009) |
| `/api/meetings` | GET, POST | JWT | none | **N** | All tenants' meetings (SEV-011) |
| `/api/meetings/[id]` | GET, PUT, PATCH, DELETE | JWT | role | **N** | IDOR + cross-tenant delete (SEV-011) |
| `/api/meetings/[id]/attendance` | POST | JWT | role | **N** | IDOR (SEV-011) |
| `/api/goals` | GET, POST | JWT | — | **N** | All tenants' goals (SEV-011) |
| `/api/goals/[id]` | GET, PUT, DELETE | JWT | owner/role | **N** | IDOR + cross-tenant delete (SEV-011) |
| `/api/settings` | GET, PUT | JWT | custom SETTINGS check | **N — global row** | Cross-tenant config write (SEV-004) |
| `/api/settings/share-value-status` | GET | JWT | none | **N — global row** | SEV-004 |
| `/api/audit` | GET | JWT | role Admin/Manager/SA | **N** | All tenants' audit trail (SEV-008) |
| `/api/audit/metadata` | GET | JWT | role Admin/Manager/SA | n/a | OK (no business rows) |
| `/api/audit/notifications` | GET | JWT | — | n/a | OK |
| `/api/analytics/stats` | GET | JWT | perm | Y | OK |
| `/api/analytics/analysis` | GET | JWT | perm | Y | OK |
| `/api/reports/generate/[type]` | GET | JWT | perm | Y | OK |
| `/api/reports/export-generic` | POST | JWT | **none** | n/a | Client-data → CSV; low impact (SEV-017) |
| `/api/backup` | GET | JWT | role Admin/SA | platform-ish | OK |
| `/api/backup/list` | GET | JWT | role Admin/SA | **N** | List of all backups (SEV-012) |
| `/api/backup/restore` | POST | JWT | role Admin/SA | n/a | Stub |
| `/api/backup` | POST | `CRON_SECRET` bearer | secret | n/a | Non-timing-safe compare (SEV-024) |

---

## Findings

### [SEV-001] `getAuthContext` trusts client-supplied `x-user-*` headers — full auth bypass, privilege escalation, tenant escape — Severity: Critical

- **Location:** `lib/middleware/auth.ts:452-481` (primary). Consumed by every Next.js-native route via `getAuthContext`.
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
    return { user: { id: userId, tenantId, ..., role, status: 'active', permissions, ... }, tenantId };
  }
  const { user, tenant, error } = await authenticateRequest(request);   // ← never reached
```

A repo-wide grep for `x-user-id|x-user-role|x-tenant-id|x-user-email|x-user-permissions|x-user-name|x-user-member-id` returns **hits only in `lib/middleware/auth.ts:452-475` — all reads**. No file in the repo ever *sets* these headers (`middleware.ts` does not), so this branch is reachable only by an external caller sending them directly.

- **Impact:** An unauthenticated attacker sends
  `curl -H 'x-user-id: <any-uuid>' -H 'x-user-role: SuperAdmin' -H 'x-tenant-id: <victim-tenant-uuid>' -H 'x-user-email: <platform-owner-email>' https://host/api/members`.
  The early return short-circuits `authenticateRequest()` entirely, so **JWT signature verification, blacklist revocation, `users.status` checks, tenant suspended/maintenance checks and the subscription gate are all skipped**. The attacker becomes a platform SuperAdmin in any tenant with no credentials at all. `x-user-permissions` is `JSON.parse`d straight into the permission evaluator, so any screen can be forced to `WRITE`. This is complete compromise of a real-money multi-tenant system.
- **Fix:** Delete the header branch entirely (it is dead code from the old Express `protect` middleware and is not populated by any caller). If a trusted upstream identity provider is ever introduced, gate it behind an explicit `TRUSTED_IDP_SECRET` HMAC over the header set, never on header presence alone. Failing that, at absolute minimum, require a shared secret header and verify it with `crypto.timingSafeEqual` before trusting any `x-user-*` value.

---

### [SEV-002] `GET /api/projects` returns every tenant's projects to any authenticated user — Severity: Critical

- **Location:** `app/api/projects/route.ts:6-8` → `server/src/modules/members/handlers.ts:104-114` → `server/src/modules/projects/service.ts:7-33`
- **Evidence:**

```ts
// server/src/modules/members/handlers.ts:104
export async function handleListProjects(request: NextRequest) {
  try {
    await requireSession();                                  // no role check, no requireTenant
    const url = new URL(request.url);
    const fundId = url.searchParams.get('fundId') || undefined;
    const status = url.searchParams.get('status') || undefined;
    const result = await projectsService.listProjects({ fundId, status });
```
```ts
// server/src/modules/projects/service.ts:7 — no tenantId parameter at all
export async function listProjects(query?: { status?: string; fundId?: string }) {
  const conditions = [];
  if (query?.status) conditions.push(eq(projects.status, query.status));
  if (query?.fundId) conditions.push(eq(projects.linkedFundId, query.fundId));
  const rows = await db.select({ id: projects.id, title: projects.title, budget: projects.budget,
      totalEarnings: projects.totalEarnings, totalExpenses: projects.totalExpenses,
      currentFundBalance: projects.currentFundBalance, ... })
    .from(projects)
    .where(conditions.length > 0 ? and(...conditions) : undefined)   // ← no projects.tenantId
```

- **Impact:** `projects.tenantId` exists and is indexed (`db/schema/projects.ts:7,27`) but is never used. A plain `Member` of investment club A calls `GET /api/projects` and receives project titles, budgets, earnings, expenses and live fund balances for **every other club on the platform** — a competitor's confidential investment pipeline. Note `requireSession()` is the *only* check, so even the weakest role reaches it.
- **Fix:** Add a `tenantId: string` parameter to `listProjects`, push `eq(projects.tenantId, tenantId)` into `conditions` as an unconditional first element, and change `handleListProjects` to `const user = await requireSession(); const tenantId = requireTenant(user);`.

---

### [SEV-003] `PUT /api/funds/[id]` — cross-tenant write IDOR with untyped body passthrough — Severity: Critical

- **Location:** `app/api/funds/[id]/route.ts:6-9` → `server/src/modules/members/handlers.ts:92-102` → `server/src/modules/funds/service.ts:141-160`
- **Evidence:**

```ts
// server/src/modules/members/handlers.ts:92
export async function handleUpdateFund(request: NextRequest, id: string) {
  try {
    assertUuid(id);
    await requirePermission('FUNDS_MANAGEMENT', 'WRITE');
    const body = (await request.json()) as Record<string, unknown>;
    const fund = await fundsService.updateFund(id, body as never);   // ← no requireTenant, no schema
```
```ts
// server/src/modules/funds/service.ts:141
export async function updateFund(id: string, data: UpdateFundData) {
  const db = getDb();
  const [existing] = await db.select().from(funds).where(eq(funds.id, id)).limit(1);   // no tenantId
  ...
  const [updated] = await db.update(funds).set(updateFields).where(eq(funds.id, id)).returning();  // no tenantId
```

`assertUuid` only proves the id *is* a UUID — the comment at `server/src/middleware/api.ts:191` claims it "rejects cross-tenant id probing early", which is false; it does not touch the tenant.
- **Impact:** Any user holding `FUNDS_MANAGEMENT` WRITE in tenant A (a **Manager** qualifies — `roleBaselineGrant` grants WRITE on every screen except `SETTINGS`, `lib/roles.ts:66`) can `PUT /api/funds/<tenant-B-fund-uuid>` and rewrite another club's `name`, `status`, `currency`, `accountNumber`, `handlingOfficer` and `linkedProjectId`. Changing `accountNumber`/`currency` on a foreign club's fund is a plausible vector for misdirecting outgoing transfers. `body as never` also silences the compiler on an unvalidated object.
- **Fix:** Thread `tenantId` through: `const user = await requirePermission('FUNDS_MANAGEMENT','WRITE'); const tenantId = requireTenant(user);` then `fundsService.updateFund(id, tenantId, updateFundSchema.parse(body))`, and change the service to `.where(and(eq(funds.id, id), eq(funds.tenantId, tenantId)))` on both the `select` and the `update`. Add a Zod schema to replace `body as never`.

---

### [SEV-004] `system_settings` is read/written as a single global row — any tenant Admin changes every tenant's money config — Severity: Critical

- **Location:** `app/api/settings/route.ts:113`, `:181`, `:304`, `:10` (cache key), `:67-70`; `app/api/governance/rules/route.ts:14-17`; `app/api/settings/share-value-status/route.ts:33,43`; `app/api/backup/list/route.ts` (0 `tenantId` references)
- **Evidence:**

```ts
// app/api/settings/route.ts
const SETTINGS_CACHE_KEY = 'settings:singleton';                       // :10  — one global cache entry
...
const [settings] = await db.select().from(systemSettings).limit(1);    // :113 — no tenant predicate
...
const [current] = (await db.select().from(systemSettings).limit(1))[0]; // :181
...
const [updated] = await db
  .update(systemSettings)
  .set(updateData)
  .where(eq(systemSettings.id, currentSettings.id))                   // :304 — writes whichever row is first
```

The schema is explicitly one-row-per-tenant, and the write path ignores it:

```ts
// db/schema/system_settings.ts:24-25
  // One row per tenant (AGENTS.md §multi-tenancy).
  tenantId: uuid('tenant_id').references(() => tenants.id),
```

Correct usage exists elsewhere — `app/api/admin/tenants/onboard/route.ts:78` does `tx.insert(systemSettings).values({ tenantId: tenant.id, companyName: name })`.
- **Impact:** `hasSettingsWritePermission` (`app/api/settings/route.ts:80-91`) grants write to any tenant `Admin`. Because the handler reads `limit(1)` and updates *that* row, an Admin of club A PUTs `/api/settings` and overwrites **club B's** `shareValueBdt`, `taxRate`, `baseCurrency`, `withdrawalLimitPercent`, `maxWithdrawalPerRequest` and `penaltyRules` — the exact knobs that govern what a member's share is worth and how much they may withdraw. For a real-money club this is direct financial tampering by a competing tenant. `checkAndAutoLockShareValue` (`:67-70`) also counts transactions globally, so the §12 share-value lock is computed across the whole platform.
- **Fix:** Scope every read/write to the caller's tenant — `.where(eq(systemSettings.tenantId, tenantId))` — add a unique index on `system_settings.tenant_id`, and key the cache by tenant (`settings:${tenantId}`) instead of `'settings:singleton'`. Same for `governance/rules`, `share-value-status` and `backup/list`.

---

### [SEV-005] Fail-open tenant clause + `register` creating tenant-less users ⇒ unfiltered cross-tenant access on the money routes — Severity: Critical

- **Location:** Fail-open pattern at `app/api/deposits/route.ts:220,231`; `app/api/deposits/request/route.ts:69,80`; `app/api/expenses/route.ts:193,222`; `app/api/dividends/calculate/route.ts:59,78,94`; `app/api/dividends/distribute/route.ts:73,92,114`; `app/api/funds/transfer/route.ts:73,79`. Root cause: `app/api/auth/register/route.ts:125-137` + `db/schema/users.ts:6`.
- **Evidence:**

```ts
// app/api/deposits/route.ts:220 — repeated across every money route
.where(and(eq(members.id, memberId), tenantId ? eq(members.tenantId, tenantId) : sql`true`))
//                                        ^^^^^^^^^^^ when tenantId is null the predicate becomes `true`
```
```ts
// app/api/auth/register/route.ts:125 — the user is created with no tenantId at all
const [created] = await db
  .insert(users)
  .values({
    name, email: normalizedEmail, password: hashed, role: newRole,
    memberId: memberId || null,
    permissions: (permissions && Object.keys(permissions).length > 0 ? permissions : getDefaultPermissions(newRole)),
  })                      // ← no tenantId: authUser.tenantId
  .returning(USER_SELECT);
```
```ts
// db/schema/users.ts:6 — nullable, so the insert above succeeds
tenantId: uuid('tenant_id').references(() => tenants.id),
```
`getAuthContext` then resolves `const resolvedTenantId = user?.tenantId || tenant?.id || null;` (`lib/middleware/auth.ts:487`) → `null`, and `requireTenant` is never called on these routes.
- **Impact:** A tenant Admin legitimately creates a user via `POST /api/auth/register`. That user has `users.tenantId = NULL`. On their next request every `tenantId ? … : sql\`true\`` predicate collapses to `true`, so `GET /api/deposits`, `GET /api/expenses`, `GET /api/transactions`, `POST /api/dividends/distribute` and `POST /api/funds/transfer` run **completely unscoped across all tenants**. They read and write every club's deposits, expenses and dividend runs, and can move money between arbitrary funds. This is a silent fail-open on the highest-value endpoints, and the system manufactures the triggering condition itself.
- **Fix:** (1) Set `tenantId: authUser.tenantId` in the `register` insert and reject a null-tenant caller. (2) Replace every `tenantId ? eq(t.tenantId, tenantId) : sql\`true\`` with a hard `eq(t.tenantId, tenantId)` after a `requireTenant(user)` call, so a null tenant is a 403 rather than an unfiltered scan. (3) Backfill `users.tenant_id` and consider `.notNull()`.

---

### [SEV-006] Penalty waiver credits money to a member of another tenant — Severity: Critical

- **Location:** `app/api/governance/penalties/[id]/waive/route.ts:39`, `:58`, `:66`, `:78`
- **Evidence:**

```ts
// :36-40 — penalty located by id only
const [penalty] = await tx.select().from(memberPenalties)
  .where(eq(memberPenalties.id, id)).limit(1);
...
// :50-58 — a foreign member's contributed total is increased
if (deduction > 0) {
  await tx.update(members)
    .set({ totalContributed: sql<string>`(${members.totalContributed}::numeric + ${deduction})::numeric(15,2)`,
           warningCount: sql<number>`GREATEST(0, COALESCE(${members.warningCount}, 0) - 1)`, updatedAt: new Date() })
    .where(eq(members.id, penalty.memberId));      // ← no tenantId
}
...
// :78
.where(eq(memberPenalties.id, id))
```

`memberPenalties.tenantId` exists and is indexed (`db/schema/member_penalties.ts:11,32`).
- **Impact:** A **Manager** of club A (`callerRole !== 'Admin' && !== 'Manager' && !== 'SuperAdmin'` at `:21` admits Managers) calls `POST /api/governance/penalties/<club-B-penalty-uuid>/waive`. It marks a foreign club's penalty `WAIVED` and **adds the deduction amount to a member's `totalContributed` in another tenant**, inflating that member's equity. The `logAudit` entry records the action but `logAudit` writes no `tenantId` (see SEV-008), so the trail is not even attributable.
- **Fix:** Resolve the tenant with `requireTenant(user)`, add `and(eq(memberPenalties.id, id), eq(memberPenalties.tenantId, tenantId))` to the select, and change both `members` updates to `and(eq(members.id, penalty.memberId), eq(members.tenantId, tenantId))`.

---

### [SEV-007] `GET /api/auth/users` returns the user directory of every tenant — Severity: Critical

- **Location:** `app/api/auth/users/route.ts:62-65`
- **Evidence:**

```ts
    const db = getDb();
    const rows = await db
      .select(USER_SELECT)          // id, name, email, role, status, permissions, memberId, lastLogin…
      .from(users)
      .orderBy(desc(users.createdAt));   // ← no eq(users.tenantId, …), no requireTenant
```

- **Impact:** Any user with role `Admin`, `Manager` or `SuperAdmin` (`:57`) receives every user row in the `users` table across all tenants: names, email addresses, roles, per-user permission maps, `memberId` links and last-login times. This is a platform-wide PII harvest available to any single club's Manager, and it hands an attacker the exact email list needed for credential-stuffing and for `SEV-013`'s enumeration.
- **Fix:** Add `const tenantId = requireTenant(user);` and `.where(eq(users.tenantId, tenantId))` (platform operators should use `/api/admin`, per `lib/tenant.ts:12-13`).

---

### [SEV-008] `GET /api/audit` exposes the whole platform's audit trail; `logAudit` never writes `tenantId` — Severity: Critical

- **Location:** `app/api/audit/route.ts:54-78`, `:84`, `:104`; `lib/utils/audit.ts:20-21`; `db/schema/audit_logs.ts:7`
- **Evidence:**

```ts
// app/api/audit/route.ts:54 — conditions built from user-supplied filters only
const conditions: ReturnType<typeof sql>[] = [];
if (query.action) conditions.push(sql`${auditLogs.action} ILIKE ${…}`);
if (query.search) conditions.push(sql`(${auditLogs.userName} ILIKE ${…} OR ${auditLogs.details}::text ILIKE ${…})`);
const whereClause = conditions.length > 0 ? and(...conditions) : undefined;   // ← no tenant predicate
...
db.select({ …, ipAddress: auditLogs.ipAddress, userAgent: auditLogs.userAgent, details: auditLogs.details, userEmail: users.email, userRole: users.role })
  .from(auditLogs).leftJoin(users, eq(auditLogs.userId, users.id)).where(whereClause)
```
```ts
// lib/utils/audit.ts:20-21 — the writer never populates the column
await db.insert(auditLogs).values({ userId: params.user?.id || null, …
```
`audit_logs.tenantId` exists and is indexed (`db/schema/audit_logs.ts:7,20`).
- **Impact:** A Manager of one club reads every action ever recorded on the platform — including `details` payloads (emails, amounts), `ipAddress`, `userAgent`, `userEmail` and `userRole` of users in *other* clubs. Because `logAudit` never writes `tenantId`, the rows are `NULL`-tenanted anyway, so simply adding a filter would return nothing until the writer is fixed — both halves must change together. In a dispute this also destroys any plausible-deniability a per-tenant audit trail is supposed to provide.
- **Fix:** Set `tenantId` in `logAudit` (thread it from the session), backfill, then push `sql\`${auditLogs.tenantId} = ${tenantId}\`` into `conditions` unconditionally.

---

### [SEV-009] `POST /api/projects/[id]/updates` writes money balances into any tenant's project — Severity: Critical

- **Location:** `app/api/projects/[id]/updates/route.ts:42`, `:53-63`, `:79`
- **Evidence:**

```ts
// :39-43
const [project] = await tx.select().from(projects).where(eq(projects.id, id)).limit(1);
...
// :65-79
if (type === 'Earning') {
  projectUpdateFields.totalEarnings = sql<string>`(${projects.totalEarnings}::numeric + ${numericAmount})::numeric(15,2)`;
} else {
  projectUpdateFields.totalExpenses = sql<string>`(${projects.totalExpenses}::numeric + ${numericAmount})::numeric(15,2)`;
}
await tx.update(projects).set(projectUpdateFields).where(eq(projects.id, id));   // currentFundBalance too
```

The only authorization is `if (normalizeRole(user.role) === 'Member') throw` (`:20`) — so Manager **and above**, from **any** tenant.
- **Impact:** Repeated `POST /api/projects/<other-tenant-uuid>/updates {"type":"Earning","amount":999999}` calls inflate another club's `currentFundBalance`, `totalEarnings` and `totalExpenses` with no tenant check and no fund reconciliation. The inserted `projectUpdates` row (`:53-63`) does not set `tenantId` either, so the falsified entries are not even attributable to the writer's tenant.
- **Fix:** `requireTenant(user)` + `and(eq(projects.id, id), eq(projects.tenantId, tenantId))` on the select and update, and set `tenantId` on the `projectUpdates` insert. Prefer routing this through the existing `finance` service, which already handles tenant scoping and `for('update')` locking.

---

### [SEV-010] `getSessionUser()` skips token blacklist and tenant-status checks — logout and suspension do not apply to the `/api/finance/*` money routes — Severity: High

- **Location:** `server/src/lib/session.ts:35-85` (used by `requireSession` → `requirePermission`/`requireAnyPermission`/`requireTenant` in `server/src/middleware/api.ts:130-189`, which back all 10 `/api/finance/**` routes plus `/api/funds`, `/api/members` and `/api/projects`)
- **Evidence:**

```ts
// server/src/lib/session.ts:35 — the whole resolver
export async function getSessionUser(): Promise<CachedUser | null> {
  const token = (await cookies()).get(COOKIE_NAMES.ACCESS_TOKEN)?.value;
  if (!token) return null;
  let userId: string;
  try { userId = verifyToken(token, 'access').id; } catch { return null; }
  const cached = userCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.user;
  const [user] = await db.select({…}).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  if (user.status === 'suspended' || user.status === 'inactive') return null;   // ← the only status check
  …
```

Contrast the `lib/` stack, which **does** all of this:

```ts
// lib/middleware/auth.ts:183
if (await isBlacklisted(token)) { … 'Token has been revoked' … }
// lib/middleware/auth.ts:293  tenant.status === 'suspended'  → 403
// lib/middleware/auth.ts:304  tenant.isMaintenanceMode      → 503
// lib/middleware/auth.ts:489  getTenantSubscriptionBlocked   → 403
```

- **Impact:** Logout blacklists the refresh token and deletes the cookie, but the **access token keeps working for its full 15-minute lifetime on `/api/finance/*`** — so a user who logs out of a shared/public machine, or whose session is revoked in response to a compromise, can still `POST /api/finance/deposits`, `/api/finance/dividends/distribute` and `/api/finance/equity/transfer`. Symmetrically, suspending a tenant (`/api/admin/tenants/[id]` PATCH) or putting it in maintenance mode does **not** stop it transacting: the whole money API is behind a resolver that never consults `tenants.status`, `isMaintenanceMode` or `tenantSubscriptions`. A 60-second user cache (`:24`) additionally delays any revocation it does perform.
- **Fix:** Make `getSessionUser` reuse `authenticateRequest` from `lib/middleware/auth.ts` (or at minimum add `isBlacklisted(token)` + the tenant status/maintenance/subscription checks) so there is a single authoritative resolver. Long term, delete the duplicate and have `server/src/middleware/api.ts` import from `lib/`.

---

### [SEV-011] Systemic IDOR: `app/api/**/[id]` handlers key on the URL id with no `tenantId` predicate — Severity: High

- **Location (all):** `app/api/meetings/[id]/route.ts:41,97,126,172,177`; `app/api/meetings/[id]/attendance/route.ts:37`; `app/api/goals/route.ts:38-63`; `app/api/goals/[id]/route.ts:41,76,110,151,160`; `app/api/projects/[id]/route.ts:26,87,111,157,170`; `app/api/transactions/[id]/route.ts:54,100,118`; `app/api/meetings/route.ts:38,44,63`; `app/api/governance/penalties/route.ts:28-49,72`
- **Evidence:**

```ts
// app/api/transactions/[id]/route.ts:97-118 — cross-tenant soft-delete of a ledger row
const [existing] = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
if (!existing) throw new NotFoundError('Transaction');
if (existing.isDeleted) throw new ValidationError('Transaction is already deleted');
const [softDeleted] = await db.update(transactions)
  .set({ isDeleted: true, deletedAt: new Date(), deletedBy: user.id, deletionReason: reason.trim(), updatedAt: new Date() })
  .where(eq(transactions.id, id))
  .returning();
```

```ts
// app/api/goals/[id]/route.ts:156 — authorization via raw string compare, not normalizeRole
if (existing.userId !== user.id && user.role !== 'Admin' && user.role !== 'Administrator') {
  throw new ForbiddenError('You can only delete your own goals');
}
await db.delete(goals).where(eq(goals.id, id));      // hard delete, cross-tenant
```

None of these files contain a `tenantId` predicate (verified: `app/api/meetings/[id]`, `meetings`, `meetings/[id]/attendance`, `goals`, `goals/[id]`, `projects/[id]`, `projects/[id]/updates`, `transactions/[id]`, `governance/penalties`, `audit`, `auth/users`, `settings` all have **zero** `tenantId`/`requireTenant` references).
- **Impact:** A `Manager` or `Admin` of any club can enumerate UUIDs and read/modify another club's meetings, attendance, goals, projects and **financial transactions** — including soft-deleting a foreign club's ledger entry (`:118`) and hard-deleting a foreign club's goal (`:160`). `GET /api/meetings`, `GET /api/goals` and `GET /api/governance/penalties` build `whereClause` from user filters only, so they list every tenant's rows to any authenticated user. On `:156`, the raw `user.role !== 'Admin' && user.role !== 'Administrator'` check both **denies** the legitimate `SuperAdmin`/`Manager` and **admits** any legacy/case variant that `normalizeRole` would map to `Admin` — an inconsistent authorization decision in the opposite direction from the intended one.
- **Fix:** Standardise on a single helper — resolve `tenantId` via `requireTenant(user)`, then add `and(eq(table.id, id), eq(table.tenantId, tenantId))` to every select/update/delete, and call it in the list endpoints' `conditions` array unconditionally. Replace the raw role compare at `:156` with `normalizeRole(user.role) === 'Admin' || isSuperAdminRole(...)`.

---

### [SEV-012] Global-scope reads beyond settings: backup list, penalty rules, share-value status — Severity: High

- **Location:** `app/api/backup/list/route.ts` (0 `tenantId` references), `app/api/governance/rules/route.ts:14-17`, `app/api/settings/share-value-status/route.ts:33,43`
- **Evidence:**

```ts
// app/api/governance/rules/route.ts:13-17 — any authenticated user
const db = getDb();
const [settings] = await db
  .select({ penaltyRules: systemSettings.penaltyRules })
  .from(systemSettings)
  .limit(1);
```
```ts
// app/api/settings/share-value-status/route.ts:33 — counts every tenant's transactions
.where(eq(transactions.isDeleted, false));
```
- **Impact:** Penalty rules, the share-value lock state and the backup inventory are all read from platform-global scope. `/api/backup/list` is restricted to `Admin`/`SuperAdmin` (`:17-18`) but has no tenant filter, so any single club's Admin enumerates every backup artefact on the platform. `/api/governance/rules` has **no role check at all**, so a plain Member reads another club's configured penalty tiers and fund-deduction amounts.
- **Fix:** Apply the same tenant scoping as SEV-004; restrict `/api/backup*` to `requireSuperAdmin` since backups span tenants.

---

### [SEV-013] No rate limiting anywhere; login lockout is per-email only, and login enumerates users by response body and timing — Severity: High

- **Location:** `app/api/auth/login/route.ts:127-150`, `:163-174`, `:193-219`; `app/api/auth/refresh/route.ts`; `app/api/auth/forgot-password/route.ts`; `server/src/middleware/rate-limiter.ts` (unreferenced)
- **Evidence:**

```ts
// app/api/auth/login/route.ts:127-136 — keyed by email only, never by IP
const [failedCountResult] = await db.select({ count: count() }).from(loginAttempts)
  .where(and(eq(loginAttempts.email, normalizedEmail), eq(loginAttempts.success, false),
             gte(loginAttempts.timestamp, lockoutSince)));
```
```ts
// :163-174 — no user → returns immediately, skipping the bcrypt compare
if (!userRow) { …; throw new AuthError('Invalid email or password'); }
// :193-219 — user exists → three DISTINCT messages
throw new LockedError('Account is suspended. Please contact an administrator.');
throw new LockedError('Account is inactive. Please contact an administrator.');
```

A repo-wide search for `rateLimit|rate-limiter` across `app/**` and `lib/**` returns **no matches** — the rate limiter that exists in `server/src/middleware/rate-limiter.ts` is not wired into any route handler.
- **Impact:** (1) **Enumeration:** the `suspended` / `inactive` messages let an attacker confirm that an email is registered and even its state; and the no-user branch skips `bcrypt.compare` (cost 12 rounds, `lib/utils/password.ts:3`) while the found branch performs it, giving a second, timing-based oracle. (2) **Brute force:** with no IP cap, an attacker rotates email addresses to stay under the 5-per-15-minutes lockout — or simply password-sprays one password across every address. (3) `/api/auth/refresh` and `/api/auth/forgot-password` are entirely unthrottled, so the login-attempt table is an unbounded write amplifier. `/api/auth/forgot-password` *does* return a constant message (`:40-43`, good), but that only masks enumeration on that one endpoint.
- **Fix:** Add a shared limiter (the existing `server/src/middleware/rate-limiter.ts`) keyed on IP **and** email to `/api/auth/login`, plus a lower IP-only cap on `/api/auth/refresh` and `/api/auth/forgot-password`. On the login path, always run a `bcrypt.compare` against a dummy hash when the user is not found, and collapse `suspended`/`inactive`/invalid into one message and one status code.

---

### [SEV-014] `clearAuthCookies` cannot delete the refresh cookie — logout leaves a live 7-day refresh token in the browser — Severity: High

- **Location:** `lib/utils/cookies.ts:36-41` (delete) vs `:26-32` (set)
- **Evidence:**

```ts
// lib/utils/cookies.ts:26-32 — the refresh cookie is scoped to /api/auth
cookies.set(COOKIE_NAMES.REFRESH_TOKEN, refreshToken, {
  httpOnly: true, secure: isProduction, sameSite,
  maxAge: REFRESH_COOKIE_MAX_AGE,
  path: '/api/auth',        // ← narrower than the access cookie's path: '/'
});
```
```ts
// lib/utils/cookies.ts:36-41 — deletes with the default path ('/')
export function clearAuthCookies(cookies: { delete: (name: string) => any } | any): void {
  cookies.delete(COOKIE_NAMES.ACCESS_TOKEN);
  cookies.delete(COOKIE_NAMES.REFRESH_TOKEN);   // ← emits Path=/, does not match Path=/api/auth
}
```

Cookie deletion is matched on (name, domain, path). A `Set-Cookie: refreshToken=; Max-Age=0; Path=/` does not remove the cookie stored at `Path=/api/auth`.
- **Impact:** After `POST /api/auth/logout` the 7-day `refreshToken` **remains in the browser** and is still accepted by `POST /api/auth/refresh` (the blacklist insert at `app/api/auth/logout/route.ts:39-45` is wrapped in a `try {} catch {}` that swallows failures, `:47`). A user who logs out on a shared or public machine — the exact scenario the endpoint exists for — can have the session silently re-established by any later visitor. The DB `sessions` row is marked inactive but `getSessionUser` (`server/src/lib/session.ts`) never checks `sessions.isActive`, so the JWT alone continues to authorize.
- **Fix:** `cookies.delete(COOKIE_NAMES.REFRESH_TOKEN, { path: '/api/auth' })` (and `{ path: '/' }` for the access cookie). Then enforce `sessions.isActive` in `getSessionUser`/`authenticateRequest` so the session table is authoritative.

---

### [SEV-015] No CSRF token or `Origin` check on any state-changing route; `SameSite` degrades to `Lax` outside production — Severity: High

- **Location:** `lib/utils/cookies.ts:15`; no origin/host validation exists in any `app/api/**/route.ts` (searched `Origin`, `csrf`, `CSRF` across `lib/**` — only the `sameSite` string literals in `cookies.ts`)
- **Evidence:**

```ts
// lib/utils/cookies.ts:14-15
const isProduction = process.env.NODE_ENV === 'production';
const sameSite = isProduction ? 'strict' : 'lax' as const;
```

`middleware.ts` applies no CSRF logic to `/api/**` — only a cookie-presence check (`middleware.ts:47-55`) — and no route handler validates `Origin`/`Sec-Fetch-Site`.
- **Impact:** In production, `SameSite=Strict` is a real mitigation and this is the reason I rate it High rather than Critical. But the guarantee rests entirely on `NODE_ENV`, so any staging, preview or self-hosted deployment running with `NODE_ENV !== 'production'` silently drops to `Lax`, where a top-level cross-site navigation carries the cookie. Combined with the fact that these endpoints move money (`POST /api/funds/transfer`, `/api/finance/deposits/bulk`, `/api/finance/equity/transfer`, `PUT /api/settings`), a misconfigured environment is a direct CSRF-to-money path. `SameSite=Strict` is also a poor fit for a dashboard that may embed an iframe or be linked from an email.
- **Fix:** Add an `Origin`/`Sec-Fetch-Site` allowlist check to every non-GET route handler (a small `assertSameOrigin(request)` helper called at the top of each mutating handler), and set `sameSite: 'strict'` unconditionally for the refresh cookie. Keep the cookie flags as defence in depth, not as the only control.

---

### [SEV-016] Password change does not invalidate sessions or tokens, and no password-reset flow exists — Severity: High

- **Location:** `app/api/auth/profile/password/route.ts:49-54`; `app/api/auth/forgot-password/route.ts:20-43`
- **Evidence:**

```ts
// app/api/auth/profile/password/route.ts:49-54 — rehash only
const hashed = await hashPassword(newPassword);
await db.update(users).set({ password: hashed, updatedAt: new Date() }).where(eq(users.id, userId));
return NextResponse.json({ success: true, message: 'Password changed successfully' });
```
```ts
// app/api/auth/forgot-password/route.ts:29-43 — audit row only; no token, no mail, no reset endpoint
if (user) { await logAudit({ … action: 'PASSWORD_RESET_REQUESTED' … }); }
return NextResponse.json({ success: true, message: 'If an account matches this email, password recovery instructions have been sent.' });
```

There is no `app/api/auth/reset-password/route.ts`; the only `profile/password` route is the authenticated `PUT`.
- **Impact:** After a user changes their password — the standard response to suspected compromise — every existing session and refresh token stays valid for up to 7 days, so an attacker who stole a session retains it. Separately, `/api/auth/forgot-password` reports success but performs no recovery: it writes an audit row and returns. A locked-out administrator has no self-service path, which in practice drives support to hand-reset credentials over less-trustworthy channels. (The endpoint's constant-response anti-enumeration design at `:39-43` is otherwise correct and should be kept.)
- **Fix:** On password change, blacklist the caller's tokens, set `sessions.isActive = false` for that user, and require re-login. Implement reset properly: `crypto.randomBytes(32)` token, store only its SHA-256 hash, single-use, ≤15-minute expiry, and invalidate all sessions on redemption.

---

### [SEV-017] Little or no Zod validation on Next.js state-changing routes; `body as never` bypasses type checking — Severity: Medium

- **Location:** `server/src/modules/members/handlers.ts:67`, `:78`, `:97`, `:112`; `app/api/auth/login/route.ts:105-113`; `app/api/auth/register/route.ts:83-100`; `app/api/goals/[id]/route.ts:89-95`; `app/api/projects/[id]/route.ts:96-106`; `app/api/auth/profile/password/route.ts:20-30`; `lib/utils/validation.ts` (schemas exist but are largely unused)
- **Evidence:**

```ts
// server/src/modules/members/handlers.ts:78, 97, 112 — hand-rolled with casts
type: (body.type as 'DEPOSIT' | 'PRIMARY' | 'PROJECT' | 'OTHER') || 'OTHER',
initialBalance: body.initialBalance ? Number(body.initialBalance) : undefined,
…
const fund = await fundsService.updateFund(id, body as never);          // :97
```
```ts
// app/api/auth/login/route.ts:105-113 — presence check only
const body = await request.json();
const { email, password, location } = body;
if (!email || !password) { … 400 … }
```

`lib/utils/validation.ts` exports `loginSchema`, `registerSchema`, `updateUserSchema`, `changePasswordSchema`, `adminPasswordResetSchema` and `updateSettingsSchema`, but only `updateSettingsSchema` is actually applied (`app/api/settings/route.ts:165`). The `server/src` handlers *do* validate properly via `validateBody(request, depositSchema)` (`server/src/middleware/api.ts:88-107`).
- **Impact:** `email`/`password` reach `normalizeEmail` and `bcrypt.compare` with no type or length constraint; `initialBalance` is coerced with `Number()` so `NaN`, `Infinity`, exponent strings (`1e400`) and negative values are not rejected at the boundary; `body as never` in `updateFund` means TypeScript cannot help if the whitelist in `funds/service.ts:148-155` is ever loosened. The per-field `Number()` coercions in `goals/[id]` (`:91-92`) can store `"NaN"` into a `decimal(15,2)` money column.
- **Fix:** Validate every mutating body with a Zod schema through `validateBody` (or `schema.safeParse`) before any service call, delete the `as never` casts, and add `.positive()` / `decimal(15,2)` refinements to all money fields. The two `server/src` modules already demonstrate the correct pattern.

---

### [SEV-018] `middleware.ts` skips *all* fencing for any path containing a dot — Severity: Medium

- **Location:** `middleware.ts:30-37`, evaluated before both the `/api/` cookie check (`:47-55`) and the `/admin` platform fence (`:67-69`)
- **Evidence:**

```ts
// middleware.ts:30-37
if (
  pathname.startsWith('/_next') || pathname.startsWith('/static') ||
  pathname.startsWith('/favicon') || pathname.includes('.')     // ← any dot anywhere
) {
  return NextResponse.next();
}
```

- **Impact:** Any path containing a `.` bypasses middleware entirely — including the `/admin` platform-operator fence and the `/api` cookie-presence check. Today no shipped route has a dot in its path, so the practical exposure is limited to the loss of defence-in-depth: a future `/admin/tenants/abc.com` or a `/api/.../v1.0/...` route would be unfenced, and the 401 JSON contract for `/api/**` would silently not apply. It also means `pathname.includes('.')` is a broader condition than the intent (static-asset skipping) suggests — `.well-known`, versioned segments and any id containing a dot.
- **Fix:** Drop the `pathname.includes('.')` clause and rely on the `config.matcher` (which already excludes `_next/static`, `_next/image`, `favicon.ico` and `public/`). If a dot check is genuinely needed, restrict it to a known static-asset extension set.

---

### [SEV-019] `/admin` pages have no server-side guard — the only fence is an edge claim check — Severity: Medium

- **Location:** `app/admin/layout.tsx`, `app/admin/page.tsx`, `app/admin/audit-logs/page.tsx`, `app/admin/billing/page.tsx`, `app/admin/diagnostics/page.tsx`, `app/admin/impersonate/page.tsx`, `app/admin/notices/page.tsx`, `app/admin/tenants/page.tsx`, `app/admin/tenants/[id]/page.tsx` — none contain `requireSuperAdmin`, `getAuthContext` or `redirect`; fence is `middleware.ts:65-69` + `lib/edge-auth.ts:38-44`
- **Evidence:**

```ts
// middleware.ts:65-69 — the entire /admin authorization
const platform = isPlatformEdge(claims);
if (pathname.startsWith('/admin') && !platform) {
  return NextResponse.redirect(new URL('/', request.url));
}
```
```ts
// lib/edge-auth.ts:38-44 — platform = any of three claims
export function isPlatformEdge(claims: EdgeAuthClaims): boolean {
  return isSuperAdminRole(claims.role) || isPlatformOwnerEmail(claims.email) || !!claims.impersonatedBy;
}
```

- **Impact:** The claim is signed with `JWT_SECRET` so it cannot be forged without the secret, and `requireSuperAdmin` on the backing APIs (`lib/admin-guard.ts:11`) is authoritative — so this is not an auth bypass today. It is a single layer of defence for the entire platform console: (a) a role change or suspension is not reflected until the 15-minute access token expires; (b) any server-side rendering hole that renders an `/admin` page's data without going through a guarded API would be unfenced; and (c) `impersonatedBy` grants full platform-page access for 30 minutes to an impersonation token, which is by design but wide. The `/admin` pages also inherit the SEV-018 dot bypass.
- **Fix:** Add a server-side guard to `app/admin/layout.tsx` (call `getAuthContext` + `requireSuperAdmin` and `redirect('/')` on failure) so the console does not depend solely on edge claims.

---

### [SEV-020] Unvalidated enum mass-assignment on `members.role` — Severity: Medium

- **Location:** `app/api/members/[id]/route.ts:131` (compare `app/api/members/route.ts:31`, which does whitelist on create)
- **Evidence:**

```ts
// app/api/members/[id]/route.ts:130-135
if (body.phone !== undefined) patch.phone = String(body.phone).trim();
if (body.role !== undefined) patch.role = String(body.role);        // ← no whitelist
if (body.status !== undefined) {
  if (!UPDATABLE_STATUS.includes(String(body.status))) throw new ValidationError('Invalid status');
  patch.status = String(body.status);
}
```

For contrast, `app/api/members/route.ts:31` on create does whitelist: `const MEMBER_ROLES = ['Admin','Administrator','Manager','Audit','Investor','Associate Member','Member'];`
- **Impact:** I verified `db/schema/members.ts:12` — `members.role` is a **club role** varchar (`default('Member')`), *not* the auth role on `users`, so this is **not** a route to `SuperAdmin` and I am explicitly not rating it as privilege escalation. The real impact is weaker governance data: a Manager (who holds `MEMBERS` WRITE by baseline) can set any member's club role to an arbitrary string, and because `idx_members_role_status` (`db/schema/members.ts:47`) drives role-filtered listings, a garbage value can remove a member from governance views.
- **Fix:** Reuse the same `MEMBER_ROLES` allowlist on update, ideally by extracting it to a shared constant used by both the create and update paths.

---

### [SEV-021] Impersonation token is returned in the response body and grants platform-console access — Severity: Medium

- **Location:** `app/api/admin/impersonate/route.ts:44-47`; `lib/superadmin-service.ts:203-233`; `lib/edge-auth.ts:42`
- **Evidence:**

```ts
// app/api/admin/impersonate/route.ts:44-47
return NextResponse.json({
  success: true,
  data: { token: session.token, expiresIn: IMPERSONATION_TOKEN_TTL, tenantId: session.tenantId },
});
```
```ts
// lib/superadmin-service.ts:222-232 — impersonatedBy rides in the token
const token = generateAccessToken(target.id, {
  role: normalizeRole(target.role), email: target.email,
  tenantId: target.tenantId ?? null, subscriptionBlocked: false,
  impersonatedBy: admin.id,
}, IMPERSONATION_TOKEN_TTL);          // '30m'
```

- **Impact:** `issueImpersonationToken` is well-guarded (it refuses to impersonate a platform operator, `:218-220`) and the route requires `requireSuperAdmin` — so there is no escalation. The concern is delivery and blast radius: the 30-minute token is handed to the browser in a JSON body rather than an HttpOnly cookie, and because `lib/edge-auth.ts:42` treats `!!claims.impersonatedBy` as `isPlatformEdge`, that token also unlocks the entire `/admin` console (`middleware.ts:67`) for 30 minutes, not just the target tenant. A token leaked from browser history, a `Referer`, or an XSS on the admin page becomes a 30-minute platform-wide session rather than a single-tenant support session. The re-validation itself is sound: `authenticateRequest` re-reads `role`/`tenantId` from the DB, and `impersonatedBy` is only trusted for edge page fencing.
- **Fix:** Set the impersonation token as an HttpOnly, `Secure`, `SameSite=Strict` cookie scoped to the target tenant's API rather than returning it in the body, and have `isPlatformEdge` key off a separate, explicitly-issued platform-admin marker instead of `impersonatedBy`. Already done well: start and end are both written to `super_admin_action_log` with both identities (`:35-42`, `:94-100`).

---

### [SEV-022] Global member-code generation ignores tenant — Severity: Medium

- **Location:** `app/api/members/route.ts:19-28`
- **Evidence:**

```ts
// app/api/members/route.ts:19-25
async function generateMemberId(db: ReturnType<typeof getDb>): Promise<string> {
  const [row] = await db
    .select({ maxNum: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${members.memberId} FROM 5) AS INTEGER)), 0)` })
    .from(members)
    .where(sql`${members.memberId} ~ '^MEM-[0-9]{4}$'`);   // ← platform-wide MAX
  const next = Number(row?.maxNum ?? 0) + 1;
  return `MEM-${String(next).padStart(4, '0')}`;
}
```

- **Impact:** `MAX` is computed over every tenant, so member codes are globally serialised (a data-integrity quirk, not a leak). More importantly, `^MEM-[0-9]{4}$` caps at `MEM-9999`: once any tenant reaches 9999 members the generator returns `MEM-10000`, which no longer matches the regex, and `app/api/members/[id]/route.ts:103` falls back to matching on `memberId` string equality — a subtle correctness cliff for a growing platform. `POST /api/members` does set `tenantId: user.tenantId` correctly (`:90`), so this is the one creation path that gets tenancy right.
- **Fix:** Scope the `MAX` to the caller's tenant, and widen the pattern to `^MEM-\d+$` (or move to a per-tenant sequence) so the id space cannot be exhausted.

---

### [SEV-023] `CRON_SECRET` compared with `!==` instead of a constant-time comparison — Severity: Medium

- **Location:** `app/api/backup/route.ts:26-34`
- **Evidence:**

```ts
// app/api/backup/route.ts:26-29
const cronSecret = process.env.CRON_SECRET;
const auth = request.headers.get('authorization');

if (!cronSecret || !auth || auth !== `Bearer ${cronSecret}`) {
  return NextResponse.json({ success: false, message: 'Invalid or missing cron secret' }, { status: 401 });
}
```

- **Impact:** `String.prototype!==` short-circuits on the first differing byte, so the comparison time is a (noisy, network-amplified) function of how many leading characters of the guess are correct — a classic timing side channel. The endpoint is also unauthenticated by session and reaches `performBackup()` across all tables, so a partial-secret oracle is more sensitive than usual. The `!cronSecret` short-circuit is good: the endpoint fails closed when the env var is unset.
- **Fix:** Compare with `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` after hashing both to fixed-length buffers, and consider restricting the cron path by source IP/method as well.

---

### [SEV-024] Real-looking secrets committed in the untracked `.env.example` template — Severity: Medium

- **Location:** `.env.example` (values redacted); ignore rule `.gitignore` (final line `.env*`)
- **Evidence:** Structural check only, no values printed:

| Key | Length | Placeholder-like | Contains `user:pass@` in a URL |
|---|---|---|---|
| `DATABASE_URL` | 56 | no | **yes** |
| `JWT_SECRET` | 33 | no | – |
| `JWT_REFRESH_SECRET` | 39 | no | – |
| `CRON_SECRET` | 33 | no | – |
| `SUPERADMIN_EMAIL` | 25 | no | – |
| `SUPERADMIN_EMAILS` | 25 | no | – |

`git ls-files -- .env.example .env.local` returns **empty**, so the file is currently untracked (the trailing `.env*` rule in `.gitignore` covers it). No hardcoded secret was found in tracked source — every consumer reads `process.env` (`lib/utils/jwt.ts:30-47`, `lib/platform-owner.ts:11-12`, `app/api/backup/route.ts:26`).
- **Impact:** A file *named* `.env.example` — the conventional "safe to commit" template — contains a Postgres URL with an embedded `user:password` and three 33–39-character secrets that do not look like placeholders. The immediate risk is that these are the real development/production credentials sitting in an untracked file, and that anyone who adds an exception for `.env.example` (a very common change when onboarding) commits a live database password and both JWT signing keys. Because `JWT_SECRET` signs the access token, exposure means forging tokens for **any** user in any tenant, and `JWT_REFRESH_SECRET` means forging 7-day sessions — a full platform compromise. `SUPERADMIN_EMAIL(S)` in the same file hands an attacker the exact identity `isPlatformOwnerEmail` trusts.
- **Fix:** Replace every value in `.env.example` with an unmistakable placeholder (e.g. `postgresql://USER:PASSWORD@HOST:5432/DB`, `change-me-32-chars-minimum`) so the template can never carry live credentials. Rotate `JWT_SECRET`, `JWT_REFRESH_SECRET` and `CRON_SECRET` if these values have ever been used outside a throwaway local database. **Do not print these values into any ticket, log or commit message.**

---

### [SEV-025] Internal error messages returned to clients and full error objects logged — Severity: Low

- **Location (returned raw):** `app/api/transactions/[id]/route.ts:66,138`; `app/api/goals/[id]/route.ts:53,129`; `app/api/goals/route.ts:69,122`; `app/api/projects/[id]/route.ts:60,130,189`; `app/api/projects/[id]/updates/route.ts:100`; `app/api/meetings/route.ts:84,141`; `app/api/meetings/[id]/route.ts`; `app/api/governance/penalties/[id]/waive/route.ts:100`; `app/api/governance/rules/route.ts:28`; `app/api/deposits/route.ts:148,316`; `app/api/expenses/route.ts:123,307`; `app/api/settings/share-value-status/route.ts`; `app/api/reports/export-generic/route.ts:61`
- **Evidence:**

```ts
// app/api/governance/penalties/[id]/waive/route.ts:99-102 — every error, incl. 500s
return NextResponse.json(
  { success: false, message: err.message || 'Failed to waive penalty' },
  { status: err.statusCode || 500 }
);
```
```ts
// app/api/auth/refresh/route.ts:112 — whole error object to the log
console.error('[REFRESH ERROR]', error);
```

The legacy kernel already does this correctly, which shows the intended pattern:
```ts
// server/src/middleware/api.ts:76
message: appErr.statusCode >= 500 ? 'An unexpected error occurred' : appErr.message,
```
- **Impact:** Driver-level messages — Postgres constraint names, column names, relation names, occasionally values — are echoed to the client on any unexpected failure, giving an attacker schema and data-shape reconnaissance for free. The blanket `console.error(error)` calls also risk writing request-derived or record-derived payloads into logs. I rate this Low because the routes that matter most (`/api/finance/*`) use the masking kernel, and because no stack traces are returned.
- **Fix:** Apply the `server/src/middleware/api.ts:76` rule uniformly — mask any `statusCode >= 500` to a generic message and log the real error server-side with a correlation id. Log structured fields, never whole error objects containing row data.

---

### [SEV-026] 60-second in-process identity caches bound revocation latency — Severity: Low

- **Location:** `lib/middleware/auth.ts:25-35` (30s auth + maintenance caches), `lib/subscription-guard.ts:24-26` (60s), `server/src/lib/session.ts:24-25` (60s)
- **Evidence:**

```ts
// lib/middleware/auth.ts:28-35 — the design comment is explicit about the tradeoff
const AUTH_CACHE_TTL_MS = 30_000;
const authCache = new Map<string, { user: AuthenticatedUser; tenant: TenantInfo | null; expiresAt: number }>();
```
```ts
// server/src/lib/session.ts:24-25
const USER_CACHE_TTL = 60_000;
const userCache = new Map<string, { user: CachedUser; expires: number }>();
```

- **Impact:** Module-level `Map`s do not survive a cold start and are per-instance, so on Vercel they are both ineffective as caches and, more importantly, they delay status propagation: a suspended user or a deactivated role stays authorized for up to 30s on the `lib/` path and 60s on the `server/src` path. `blacklistToken` does evict correctly on the `lib/` path (`:42`), which is the important part, but the `server/src` path has no blacklist at all (SEV-010) and only this 60s cache between a suspension and its effect. This is a documented, intentional trade-off (`ponytail:` comment at `lib/middleware/auth.ts:24`) and I am not treating it as a defect — it is recorded so the bound is known.
- **Fix:** Keep the caches for the happy path, but invalidate on write: have the admin suspend/delete/role-change routes and `logout-all` clear the relevant cache entries, and reduce the `server/src` cache TTL or key it on the token hash rather than the user id.

---

## Needs verification

1. **Whether the `x-user-*` header path (SEV-001) is reachable in production.** I proved nothing in this repository sets those headers, and `request.headers` in a Next.js route handler is the client-supplied request. I could not inspect the deployment edge/proxy config. **Confirm by:** issuing `curl -H 'x-user-id: 00000000-0000-0000-0000-000000000000' -H 'x-user-role: SuperAdmin' https://<host>/api/auth/me` against a deployed preview — a 200 with a fabricated user confirms Critical; a 401 means a proxy is stripping the headers and this drops to High (still an auth bypass waiting for a misconfiguration).
2. **Whether `.env.example` secrets (SEV-024) ever entered git history.** The file is untracked today, but `.gitignore` has been edited over time and this audit only inspected the working tree. **Confirm by:** `git log --all --diff-filter=A -- .env.example` and `git log -S 'JWT_SECRET=' --all -- .` , plus a history scan for the literal values. A hit means an immediate rotation and history rewrite.
3. **Whether a database currently contains `users.tenant_id IS NULL` (SEV-005).** The code path guarantees such rows are creatable, but I have no database access. **Confirm by:** `SELECT count(*) FROM users WHERE tenant_id IS NULL;` and `SELECT count(*) FROM funds WHERE tenant_id IS NULL;` (the latter should be non-zero if anyone has used `POST /api/funds`, because `server/src/modules/funds/service.ts:102-115` never sets `tenantId` on insert). Non-zero counts mean the fail-open exposure is live right now.
4. **Whether `super_admin_action_log` and `audit_logs` can be attributed after the fact (SEV-008).** `logAudit` writes no `tenantId`, so existing rows cannot be retro-fitted by tenant without a join through `users.tenant_id` — which is itself null for SEV-005 rows. **Confirm by:** sampling `SELECT count(*) FROM audit_logs WHERE tenant_id IS NULL;` against the current data volume to size the backfill.
5. **The intended CSRF posture (SEV-015).** `SameSite=Strict` in production is a genuine mitigation, so the real question is which environments run with `NODE_ENV !== 'production'`. **Confirm by:** checking the Vercel project settings and any non-Vercel deployment for `NODE_ENV`, and whether preview deployments are reachable from a browser a third party could drive.
6. **Duplicate permission evaluators.** `lib/permissions.ts:37-61` and `server/src/middleware/api.ts:26-61` are near-identical copies of the same logic, and `lib/roles.ts` is mirrored at `server/src/shared/roles.ts`. I verified they currently agree on the cases I traced (role normalization, parent-screen fallback), but **any** future divergence is a silent authorization split. **Confirm by:** adding a shared test vector asserting both implementations return identical results for all 5 roles × 16 screens × {READ, WRITE}.
7. **`logAudit` failure mode.** `lib/utils/audit.ts` is called *after* the mutation in every handler I read, so a logging failure cannot roll back — correct for availability, but it means an audit gap is silent. **Confirm by:** checking whether any handler logs *before* mutating, and whether `logAudit` swallows its own errors.

---

## What is done right (short, so we don't regress it)

- **JWT fundamentals are sound.** HS256 with a server-side `JWT_SECRET` (no `none`, no algorithm confusion), 15m access / 7d refresh lifetimes (`lib/utils/jwt.ts:4-5`), and — importantly — the refresh secret is domain-separated from the access secret (`:40`, HMAC-derived with a fixed salt) so a leaked access key cannot mint refresh tokens. `type` is checked on every verify (`:79-81`).
- **Refresh rotation with reuse detection.** The old token is blacklisted *before* a new pair is issued, and a unique-constraint violation (`23505`) is translated into `TOKEN_REVOKED` (`app/api/auth/refresh/route.ts:73-93`) — the correct shape for reuse detection.
- **Fail-closed tenant resolution in both stacks.** `lib/tenant.ts:11-19` and `server/src/middleware/api.ts:244-252` both reject a null tenant and explicitly refuse to let platform operators use business routes. The design is right; SEV-005 is about routes that simply *forget to call* it.
- **The legacy finance service is rigorously tenant-scoped.** Every query in `server/src/modules/finance/service.ts` pairs the row id with `eq(table.tenantId, tenantId)` (e.g. `:424`, `:426`, `:508`, `:633`, `:1226-1227`, `:1454`, `:1585`), calls `requireTenant(user)` first, and takes `for('update')` row locks inside a transaction. This is the model the rest of the codebase should be brought up to.
- **Financial invariants are respected.** Soft delete only, with `deletedBy` + `deletionReason` and an audit entry (`app/api/transactions/[id]/route.ts:108-127`); the share-value lock is enforced server-side and re-checked on write (`app/api/settings/route.ts:232-234`); money is handled as integer cents / `decimal(15,2)` with `parsePositiveAmount`; and deposits reject a share-number change outright (`:54-56`).
- **Two-layer authorization on approvals.** `app/api/deposits/[id]/approve/route.ts` re-verifies the fund and member against the caller's tenant (`:62`, `:75`) before crediting, so the subsequent id-only updates at `:96`/`:110` are transitively safe — a genuinely correct pattern, and the model for fixing SEV-003/006/009.
- **Bcrypt with cost 12** and a 12-character mixed-character policy (`lib/utils/password.ts:3-6`), and `comparePassword` used everywhere.
- **Password reset cannot be used for enumeration** — constant response regardless of whether the account exists (`app/api/auth/forgot-password/route.ts:39-43`).
- **HTTP-only cookie auth, never `localStorage`.** Both cookies are `httpOnly` (`lib/utils/cookies.ts:18,27`), the refresh cookie is path-scoped to `/api/auth` (`:31`), and the client uses `credentials: 'include'` with no token in `localStorage` or the query string. Client-side `localStorage` holds only a display profile and a locale (`lib/auth-context.tsx:75`, `lib/i18n.tsx:57`) — no token, so XSS cannot exfiltrate a session directly.
- **Impersonation refuses to target platform operators** and records both identities in `super_admin_action_log` (`lib/superadmin-service.ts:218-220`).
- **Default tenant is protected** from suspension and deletion (`app/api/admin/tenants/[id]/route.ts:72`, `:157`), and tenant deletion refuses while users exist (`:170`).
- **The `lib/` auth stack is careful**: JWT signature is verified *before* the blacklist DB lookup so forged tokens never reach the database (`lib/middleware/auth.ts:166-180`), and `blacklistToken` evicts the identity cache so revocation is immediate (`:42`).
- **`roleBaselineGrant` defaults deny.** Unknown roles normalize to `Member` (`lib/roles.ts:40`) and every screen outside the member read-set is `NONE` (`:69`), so a bad role string reduces privilege rather than granting it.
