# Audit 04 — Data Layer, Migrations, Secrets, CI/CD & Repo Hygiene

**Scope:** `db/**`, `.github/workflows/**`, `scripts/**`, `app/api/backup/**`, root config, `server/src/config/*`, `server/src/lib/db.ts`, repo hygiene.
**Method:** read-only. All findings carry `path:line` + quoted snippet. Live app = Next.js 15 App Router at repo root (`app/`, `lib/`, `db/`). Legacy = `server/src/` (not wired in).
**Baseline note:** `tsc --noEmit` green, `next lint` clean, vitest 69/69 green — the defects below are all semantically invisible to those gates.

## Summary

| Severity | Count |
|---|---|
| Critical | 6 |
| High | 10 |
| Medium | 14 |
| Low | 5 |
| **Total** | **35** |

**Headline:** the live application and its migrations are **entirely absent from git** (`git ls-files app/ lib/ db/ components/` → 0), the migration runner is a **silent no-op**, and `/api/backup?download=true` hands **every tenant's** data — including bcrypt password hashes and live session IDs — to any Admin. Restore failures are explicitly swallowed and reported as success.

---

## Schema drift table (legacy `server/src/db/schema/` vs live root `db/schema/`)

Root = `db/schema/*.ts` (authoritative, used by `app/api/auth/sessions/route.ts:3`).
Legacy = `server/src/db/schema/*.ts` (dead, but still has a working `drizzle-kit` config + real journal).

| Table | Field | server/src (legacy) | root live | Impact |
|---|---|---|---|---|
| `audit_logs` | `tenant_id` + `idx_audit_logs_tenant_created` | **absent** | present (`db/schema/audit_logs.ts:7,20`) | `drizzle-kit push` from `server/drizzle.config.ts` drops the tenancy column + composite index from the live table |
| `fiscal_periods` | `tenant_id` + `idx_fiscal_tenant` | **absent** | present (`:7,27`) | same |
| `goals` | `tenant_id` + `idx_goals_tenant` | **absent** | present (`:8,21`) | same |
| `meetings` | `tenant_id` + `idx_meetings_tenant` | **absent** | present (`:7,23`) | same |
| `meeting_attendees` | `tenant_id` + `idx_attendees_tenant` | **absent** | present (`:8,17`) | same |
| `member_arrears` | `tenant_id` + `idx_arrears_tenant` | **absent** | present (`:8,20`) | same |
| `member_penalties` | `tenant_id` + `idx_penalties_tenant` | **absent** | present (`:11,32`) | same |
| `profit_allocations` | `tenant_id` + `idx_allocation_tenant` | **absent** | present (`:9,21`) | same |
| `projects` (`project_updates`) | `tenant_id` + `idx_project_updates_tenant` | **absent** | present (`db/schema/projects.ts:37,47`) | same |
| `system_settings` | `uq_system_settings_tenant` (UNIQUE) + `idx_system_settings_tenant` | **absent** | present (`:66,67`) | without it, N settings rows per tenant — all reads ambiguous |
| `subscription_plans`, `tenant_subscriptions`, `subscription_change_log` | whole tables | **absent** | present (`db/schema/subscriptions.ts:7,23,41`) | legacy `generate` will emit `DROP TABLE` for all three |
| `super_admin_action_log` | whole table | **absent** | present (`db/schema/super_admin_action_log.ts:7`) | same — and it is the platform audit trail that must survive a tenant wipe |
| `sessions` | **entirely different shape** | `refresh_token_hash`, `is_revoked`, `expires_at`, `last_used_at`, `user_id ON DELETE CASCADE` (`server/src/db/schema/sessions.ts:6-18`) | `session_id`, `location_country/city/region`, `login_time`, `logout_time`, `is_active`, `is_expired`, `device_info`, `os_info`, `browser_info`, plain `user_id` ref (`db/schema/sessions.ts:6-20`) | **Bidirectional drift.** Live code reads the OLD shape (`app/api/auth/sessions/route.ts:21-32` selects `sessions.sessionId`, `sessions.isActive`, `sessions.locationCountry`). A legacy `push` renames/drops ~12 columns out from under the live session-management UI. |
| `audit_logs` / `deleted_records` / `users` | trailing `export type` + comment lines | present | present | cosmetic only — no real drift |

**No drift (verified identical):** `tenants`, `members`, `funds`, `projects`, `transactions`, `blacklisted_tokens`, `login_attempts`, `global_stats`.

---

## Findings

### [DATA-001] `/api/backup?download=true` exfiltrates the entire database, all tenants — Severity: Critical
- **Location:** `app/api/backup/route.ts:7-21`, `:67-93`
- **Evidence:**
```ts
const TABLES = [
  'members', 'transactions', 'projects', 'funds', 'users',
  'system_settings', 'audit_logs', 'login_attempts', 'sessions',
  'deleted_records', 'blacklisted_tokens', 'global_stats', 'goals',
];

async function performBackup() {
  const sql = getSql();
  const backup: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    const rows = await sql.unsafe(`SELECT * FROM ${table}`);   // no WHERE tenant_id = ...
    backup[table] = rows;
  }
  return backup;
}
```
```ts
    if (download) {
      return new NextResponse(JSON.stringify(backupData), {
        headers: { 'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename=investwise-backup-${...}.json` },
      });
    }
```
- **Impact:** Any `Admin` or `SuperAdmin` (line 67-70 gate) downloads **every row of every tenant** — cross-tenant breach of `AGENTS.md` §multi-tenancy. The payload includes `users.password` (bcrypt hashes → offline cracking), `sessions.sessionId` (live session identifiers at `db/schema/sessions.ts:7`), `blacklisted_tokens.token` (raw bearer tokens, `db/schema/blacklisted_tokens.ts:6`), and member PII (`nidOrPassport`, `address`, `nomineeNidOrPassport` — `db/schema/members.ts:30-38`). An Admin of a single tenant is a full-database exfiltration primitive. There is no rate limit, no audit-log write, and no size cap.
- **Fix:** Scope every query to the caller's tenant — `sql\`SELECT * FROM ${sql(table)} WHERE tenant_id = ${tenantId}\`` (parameterized `sql.identifier` for the table name, never `unsafe` interpolation). Drop `users`, `blacklisted_tokens` and `sessions` from the export set; if session continuity is required, export hashes only. Write an `audit_logs` row for every export. Return a redacted manifest rather than raw rows.

### [DATA-002] Restore pipeline swallows `pg_restore` failure and reports success — Severity: Critical
- **Location:** `.github/workflows/db-restore-r2.yml:63-70`, `:72-77`
- **Evidence:**
```yaml
          pg_restore "$DATABASE_URL" \
            --clean \
            --if-exists \
            --no-owner \
            --no-privileges \
            ./restore.dump || true

          echo "Database restore completed."
```
```yaml
          echo "- **Status**: Restored successfully" >> $GITHUB_STEP_SUMMARY
```
- **Impact:** `--clean --if-exists` **drops and recreates** every object in the target database. If the restore fails halfway, `|| true` converts a half-destroyed production database into a **green, "Restored successfully"** workflow run. The operator has no signal, no rollback, and no pre-restore snapshot. This is a silent data-loss path on real money records.
- **Fix:** Remove `|| true`; capture the exit code and `exit 1` on failure. Add `set -euo pipefail` at the top of the step. Add a mandatory pre-restore `pg_dump` snapshot step, a `pg_restore --list` preflight on the downloaded artifact, and a checksum comparison against a manifest stored alongside the dump.

### [DATA-003] `drizzle-kit migrate` is a silent no-op — no migration is ever applied — Severity: Critical
- **Location:** `drizzle.config.ts:5`, `db/migrations/` (2 files, no `meta/`), `package.json:6-16`
- **Evidence:**
```ts
// drizzle.config.ts
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
```
```json
// package.json — no db:generate, db:migrate, db:push, db:studio
  "scripts": {
    "dev": "next dev", "build": "next build", "start": "next start",
    "lint": "next lint", "typecheck": "tsc --noEmit",
    "db:seed": "node scripts/seed-superadmin.mjs",
    "shares:realign": "node scripts/realign-member-shares.mjs",
    "test": "vitest run", "i18n:validate": "node scripts/validate-i18n.mjs"
  },
```
`db/migrations/` contains only hand-written `0001_multitenant_foundation.sql` and `0002_rbac_remove_access_level.sql`. There is **no `db/migrations/meta/_journal.json`**, so `drizzle-kit migrate` finds zero recorded entries and applies nothing while exiting 0. The only real drizzle journal in the repo belongs to the dead tree (`server/drizzle/meta/_journal.json`). There is also **no `CREATE TABLE` for `users`, `members`, `funds`, `projects`, `transactions`…** anywhere in `db/` — `0001` only does `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS` (`db/migrations/0001_multitenant_foundation.sql:86-100`), which fails on a fresh database. The live schema is created by `drizzle-kit push`/hand, outside version control.
- **Impact:** A fresh environment provisioned per the documented runbook produces an empty database (no base tables) or, worse, a database missing every column added since the last `push`. There is no reproducible schema, no `db:migrate` step in any pipeline, and no way to know what a deployed database actually contains. `AGENTS.md`'s `cd server && npm run db:generate` / `db:migrate` instructions point at the **legacy** scripts, which operate on the **stale** schema.
- **Fix:** Run `npx drizzle-kit generate` to produce a real `db/migrations/` with `meta/_journal.json` and a `0000` base-create migration, then hand-port the tenancy/RBAC statements as `0001`/`0002`. Add `db:generate`/`db:migrate` scripts to the root `package.json`, and add a `db:migrate` step gated on a CI check that the working tree is clean after generate.

### [DATA-004] The live app and all its migrations are untracked; 113 `client/` deletions unstaged — Severity: Critical
- **Location:** `.gitignore:181`, `db/migrations/*.sql`, `git status`
- **Evidence:**
```
$ git check-ignore -v db/migrations/0001_multitenant_foundation.sql
.gitignore:181:*.sql	db/migrations/0001_multitenant_foundation.sql
$ git ls-files app/ lib/ db/ components/ | wc -l
0
$ git status --porcelain | cut -c1-2 | sort | uniq -c
 32 ' M'   117 ' D'   43 '??'
```
Tracked non-doc root files are only: `.github/workflows/**`, `vercel.json`, `scripts/r2-*.js`, `*.bat`/`*.ps1`, `.mcp.json`, `skills-lock.json`, `.vscode/settings.json`, `install.ps1`.
- **Impact:** Three compounding failures. (a) `.gitignore:181 *.sql` silently excludes **every migration file**, so even `git add db/` will not commit the schema history. (b) `app/`, `lib/`, `db/`, `components/`, `middleware.ts`, `next.config.ts`, `package.json`, `tsconfig.json` are **untracked** — a fresh clone, a `git checkout .`, a `git stash`, or a CI checkout yields the dead Vite SPA with no server. (c) 113 `client/` deletions are unstaged, so any `git commit -a` that omits them leaves both trees half-present and `frontend-ci.yml` path filters matching a directory that no longer exists.
- **Fix:** Add `!db/migrations/**/*.sql` (and `!server/drizzle/**/*.sql`) to `.gitignore` *before* the `*.sql` line, scoped with `!` exceptions. Commit the deletions and the new app in one reviewed commit. Add a pre-commit check asserting `git status --porcelain` is empty and that `db/migrations/meta/_journal.json` exists.

### [DATA-005] Hardcoded default SuperAdmin password, undocumented, and it silently overwrites existing credentials — Severity: Critical
- **Location:** `scripts/seed-superadmin.mjs:41`, `:50-53`
- **Evidence:**
```js
const EMAIL = (env.SUPERADMIN_EMAIL || 'superadmin@investwise.com').toLowerCase().trim();
const PASSWORD = env.SUPERADMIN_PASSWORD || 'pass-12345678';
```
```js
  const existing = await sql`select id from users where email = ${EMAIL} limit 1`;
  if (existing.length > 0) {
    await sql`update users set password = ${hash}, role = 'SuperAdmin', status = 'active', permissions = ${sql.json(perms)}, updated_at = now() where email = ${EMAIL}`;
```
- **Impact:** `.env.example` documents `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CRON_SECRET`, `SUPERADMIN_EMAIL`, `SUPERADMIN_EMAILS` — but **not `SUPERADMIN_PASSWORD`**. An operator following the template runs `npm run db:seed` against production and creates (or **resets**) the platform SuperAdmin with the publicly-known password `pass-12345678`, while the app's own password policy requires ≥12 chars with mixed case/digit/special (`lib/utils/validation.ts:11`). The seed bypasses that policy entirely and writes no audit log. `SUPERADMIN_EMAILS` is a separate allowlist gate (`lib/platform-owner`), so a weak DB password is not the only path in.
- **Fix:** `if (!env.SUPERADMIN_PASSWORD) { console.error('SUPERADMIN_PASSWORD is required'); process.exit(1); }` — never default. Refuse to run when an existing superadmin row is found unless `--force-reset-password` is passed. Add `SUPERADMIN_PASSWORD` to `.env.example`. Write a `super_admin_action_log` row on every run.

### [DATA-006] No row-level security anywhere; `tenant_id` is nullable and unenforced at the DB layer — Severity: Critical
- **Location:** `db/index.ts:114-123`, `db/schema/*.ts` (all `tenantId` definitions), `db/migrations/*`
- **Evidence:**
```ts
// db/index.ts:114 — sets GUCs that no policy ever reads
export async function setAppContext(userId: string | null, role: string | null): Promise<void> {
  ...
    await sql`SELECT set_config('app.user_id', ${targetUserId}, true), set_config('app.role', ${targetRole}, true)`;
```
```
$ grep -rn "ROW LEVEL SECURITY|CREATE POLICY|ENABLE RLS" --include=*.ts --include=*.sql .
(no matches)
```
```ts
// db/schema/transactions.ts:10 — nullable, no default
  tenantId: uuid('tenant_id').references(() => tenants.id),
```
- **Impact:** The codebase *implements* an RLS context API (`setAppContext` / `resetAppContext`, duplicated at `server/src/config/database.ts:95-123`) and the log message even says `'Failed to set RLS app context:'` — but **no policy, no `ENABLE ROW LEVEL SECURITY`, no `FORCE ROW LEVEL SECURITY` exists anywhere**. Every `tenantId` is `nullable` with no default, so a row inserted without one is invisible to a tenant-scoped `WHERE tenant_id = $1` query rather than rejected. Tenant isolation is 100% application-layer and entirely bypassable by a single missing `WHERE` — which DATA-001 demonstrates is already the case in the backup route. `0001_multitenant_foundation.sql:214` deliberately leaves `users.tenant_id` NULL for platform operators, confirming the design intent was never DB-enforced.
- **Fix:** Add a migration that (1) backfills every NULL `tenant_id` to the default tenant, (2) `ALTER TABLE … ALTER COLUMN tenant_id SET NOT NULL`, (3) `ALTER TABLE … ENABLE ROW LEVEL SECURITY` and adds `USING (tenant_id = current_setting('app.tenant_id')::uuid)` policies. Extend `setAppContext` to set `app.tenant_id` and call it from `getAuthContext()`.

### [DATA-007] Dual source of truth: two divergent Drizzle schemas in one repo — Severity: High
- **Location:** `db/schema/index.ts:21-22` vs `server/src/db/schema/index.ts` (see drift table above)
- **Evidence:**
```ts
// db/schema/index.ts:21-22 — exists only in root
export { superAdminActionLog, type SuperAdminActionLog } from './super_admin_action_log.js';
export { subscriptionPlans, tenantSubscriptions, subscriptionChangeLog, ... } from './subscriptions.js';
```
```ts
// server/drizzle.config.ts:4 — points at the STALE tree, with a fallback DSN
  schema: './src/db/schema/*.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/postgres' },
```
- **Impact:** Two schema definitions, two `drizzle.config.ts`, two migration folders, two `package.json` files — and they disagree in **both directions**. The legacy config will `DROP TABLE subscription_plans, tenant_subscriptions, subscription_change_log, super_admin_action_log` (including the platform audit trail) and `DROP COLUMN tenant_id` from 9 live tables if anyone runs `cd server && npm run db:push` as `CLAUDE.md` instructs. The `sessions` table is the inverse case: legacy is *newer* (refresh-token rotation) while the live app still reads the *old* columns, so a legacy `push` renames columns out from under `app/api/auth/sessions/route.ts`.
- **Fix:** Delete `server/src/db/schema/`, `server/drizzle.config.ts`, and `server/drizzle/` outright (the tree is not wired into the running app), or convert `server/` into a hard-ignore block. Until then, add a CI job that diffs the two schema directories and fails on any non-comment difference.

### [DATA-008] `users_role_check` CHECK constraint is never created on a fresh database — Severity: High
- **Location:** `db/migrations/0002_rbac_remove_access_level.sql:12-51`
- **Evidence:**
```sql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'access_level'
  ) THEN
    ...
    ALTER TABLE "users"
      ADD CONSTRAINT "users_role_check"
      CHECK (role IN ('SuperAdmin', 'Admin', 'Manager', 'Auditor', 'Member'));
    DROP INDEX IF EXISTS "idx_users_access_level";
    ALTER TABLE "users" DROP COLUMN IF EXISTS "access_level";
  END IF;
END $$;
```
- **Impact:** The entire block — including the canonical `CHECK` constraint — is gated on `access_level` existing. On any database provisioned from the current schema (where `access_level` never existed), **the constraint is never created**, so `users.role` is an unconstrained `varchar(50)` with `.default('Member')` (`db/schema/users.ts:12`). Any value can be written, and `normalizeRole` (`lib/roles.ts`) is the only thing standing between a garbage role string and an authorization decision. The `DROP COLUMN access_level` is the only genuinely destructive DDL in the repo and it is non-atomic with respect to the constraint it introduces.
- **Fix:** Split into two migrations: one unconditional `ADD CONSTRAINT users_role_check CHECK (...) NOT VALID` → `VALIDATE CONSTRAINT`, and a separate idempotent `DROP COLUMN IF EXISTS access_level`. Add `status` and `meetings.status` / `meeting_attendees.attendance_status` / `deposit_status` / `member_penalties.type` / `.status` CHECKs at the same time (see DATA-019).

### [DATA-009] R2 backups are unencrypted at rest and carry the full PII + credential set — Severity: High
- **Location:** `scripts/r2-backup-upload.js:31-47`, `.github/workflows/db-backup-r2.yml:50-54`
- **Evidence:**
```js
  await s3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: `backups/${filename}`,
    Body: fileStream,
    ContentLength: fileStat.size,
  }));
```
```yaml
          pg_dump "$DATABASE_URL" \
            --format=custom \
            --no-owner \
            --no-privileges \
            --file="${FILENAME}"
```
- **Impact:** `pg_dump --format=custom` produces a **full logical dump** — `users.password` bcrypt hashes, `blacklisted_tokens.token` (raw live bearer tokens), `sessions.session_id`, member NID/passport/address/nominee, `audit_logs.details` jsonb. It is uploaded with **no `ServerSideEncryption`**, no client-side envelope encryption, no KMS key reference, and no checksum manifest. Anyone with `R2_SECRET_ACCESS_KEY` (or a leaked CI log) gets an immediately crackable credential store. Retention pruning (`:52-67`) issues `DeleteObjectCommand` per object with no bucket versioning assumption, so if versioning is off an over-long retention permanently destroys the only copy.
- **Fix:** Add `ServerSideEncryption: 'aws:kms'` (R2 supports SSE-KMS) or encrypt client-side with an age/gpg key held in a CI secret before upload. Emit a SHA-256 sidecar manifest per dump and have restore verify it. Confirm R2 bucket versioning and object-lock are enabled; guard pruning so it never deletes the newest N objects.

### [DATA-010] Restore accepts any R2 object key with no allowlist and no integrity check — Severity: High
- **Location:** `scripts/r2-restore-download.js:9`, `:27-37`
- **Evidence:**
```js
const backupFile = process.env.BACKUP_FILE || 'latest.dump';
...
  const key = backupFile.startsWith('backups/') ? backupFile : `backups/${backupFile}`;
  console.log(`Downloading ${key} from Cloudflare R2 (${bucketName})...`);

  const response = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));

  const writeStream = fs.createWriteStream('./restore.dump');
  await pipeline(response.Body, writeStream);
```
- **Impact:** The `backup_file` workflow input is attacker/operator-controlled and passes through with only a `backups/` prefix — no filename pattern, no `..` rejection, no extension check. It can point at any key in the bucket (any other prefix, any object), and the artifact is fed straight into `pg_restore --clean` (DATA-002) with **zero validation**: no `pg_restore --list` preflight, no checksum verification, no schema-version compatibility check, no `pg_restore --single-transaction`. A truncated or wrong-schema dump produces a partially-dropped live database.
- **Fix:** Validate against `/^investwise-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}Z\.dump$/` or the literal `latest.dump`; reject any key containing `/` after stripping the prefix. Verify a stored SHA-256 before use. Run `pg_restore --list ./restore.dump` as a preflight and `pg_restore --single-transaction` for the actual restore.

### [DATA-011] Zero CI coverage for the live application; both existing workflows target deleted/legacy paths — Severity: High
- **Location:** `.github/workflows/frontend-ci.yml:3-11`, `:19`, `:28`; `.github/workflows/backend-ci.yml:3-11`
- **Evidence:**
```yaml
on:
  push:
    branches: [main]
    paths:
      - 'client/**'
  pull_request:
    branches: [main]
    paths:
      - 'client/**'

jobs:
  validate:
    defaults:
      run:
        working-directory: client
```
```yaml
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: client/package-lock.json
```
- **Impact:** `client/` does not exist on disk (`Test-Path client` → `False`) and is 113 unstaged deletions. `frontend-ci.yml` will hard-fail at the `cache-dependency-path` step. `backend-ci.yml` still gates on `server/**`, the tree explicitly **not** wired into the running app. Nothing in `app/**`, `lib/**`, `db/**`, `middleware.ts`, `next.config.ts` triggers any workflow. **The live Next.js application has no CI at all** — the green local `tsc`/`vitest` baseline is not enforced anywhere. Neither workflow runs tests, lint, or any build gate against a real database.
- **Fix:** Rewrite as a single root-level `ci.yml` triggered on `app/**`, `lib/**`, `db/**`, `components/**`, `scripts/**`, `middleware.ts`, `*.ts`, running `npm ci && npm run typecheck && npm run lint && npm test && npm run build` with `working-directory` unset. Delete `frontend-ci.yml` and `backend-ci.yml` together with the legacy tree. Require it as a status check on `main`.

### [DATA-012] Script injection via unquoted `${{ github.event.inputs.* }}` in `run:` blocks — Severity: High
- **Location:** `.github/workflows/db-restore-r2.yml:21`, `:75`
- **Evidence:**
```yaml
      - name: Verify Confirmation
        run: |
          if [ "${{ github.event.inputs.confirm_restore }}" != "CONFIRM" ]; then
            echo "ERROR: Confirmation text must be exactly 'CONFIRM'. Aborting restore."
            exit 1
          fi
```
```yaml
          echo "- **Source File**: \`${{ github.event.inputs.backup_file }}\`" >> $GITHUB_STEP_SUMMARY
```
- **Impact:** Direct `${{ }}` interpolation into a shell `run:` block is the canonical GitHub Actions injection pattern. A `backup_file` value of `x\`); curl -H "Authorization: Bearer ${{ secrets.R2_SECRET_ACCESS_KEY }}" …` #` executes with the job's full secret set (all four R2 keys, at `:49-52`). `workflow_dispatch` restricts this to write collaborators, which limits the blast radius, but it is still an escalation path from a compromised maintainer token to full backup-credential theft and arbitrary CI code execution. Note that `:53` (`BACKUP_FILE: ${{ github.event.inputs.backup_file }}` via `env:`) is the *correct* pattern — the inconsistency is the bug.
- **Fix:** Move every `${{ github.event.inputs.* }}` into a step-level `env:` block and reference `"$INPUT_BACKUP_FILE"` in the shell. Add `shell: bash --noprofile --norc -eo pipefail {0}` to all `run:` steps.

### [DATA-013] No `permissions:`, no `concurrency:`, unpinned actions, unpinned install — Severity: High
- **Location:** `.github/workflows/db-backup-r2.yml:14-17`, `.github/workflows/db-restore-r2.yml:14-17`, `:27-36`
- **Evidence:**
```yaml
jobs:
  restore:
    name: Restore Database from Cloudflare R2
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
```
```yaml
      - name: Install Dependencies
        run: |
          npm install @aws-sdk/client-s3 --no-save
```
- **Impact:** (a) No `permissions:` block in **any** of the four workflows → the default `GITHUB_TOKEN` scope applies, which is `read/write` on orgs with legacy default settings. Least privilege is not requested anywhere. (b) No `concurrency:` group on the backup workflow → a scheduled run and a manual `workflow_dispatch` can overlap and race on the R2 `backups/latest.dump` pointer (uploaded at `r2-backup-upload.js:41-46`), leaving `latest.dump` pointing at a partially-uploaded object; a backup can also fire mid-restore and dump a half-restored database. (c) All actions pinned to mutable tags (`@v4`), not commit SHAs → a compromised upstream tag silently executes with `DATABASE_URL` and R2 secrets in scope. (d) `npm install @aws-sdk/client-s3 --no-save` resolves **latest** at run time with no lockfile or integrity hash. (e) `NODE_PATH: server/node_modules` (`:68`/`:54`) points into the legacy tree that is never installed in these jobs.
- **Fix:** Add `permissions: { contents: read }` to every workflow (and `contents: read` + nothing else for backup/restore). Add `concurrency: { group: db-backup, cancel-in-progress: false }` and `group: db-restore` so runs serialize. Pin all actions to full commit SHAs. Replace the ad-hoc install with a committed `package.json` + `npm ci --omit=dev` using a lockfile.

### [DATA-014] `ON DELETE CASCADE` on money-debt records — Severity: High
- **Location:** `db/schema/member_arrears.ts:9`, `db/schema/meeting_attendees.ts:9-10`, `db/schema/projects.ts:38,52-53`
- **Evidence:**
```ts
// db/schema/member_arrears.ts:9 — arrears = "this member OWED money"
  memberId: uuid('member_id').references(() => members.id, { onDelete: 'cascade' }).notNull(),
```
```ts
// db/schema/meeting_attendees.ts:9-10
  meetingId: uuid('meeting_id').references(() => meetings.id, { onDelete: 'cascade' }).notNull(),
  memberId: uuid('member_id').references(() => members.id, { onDelete: 'cascade' }).notNull(),
```
- **Impact:** Deleting a member row **silently and irreversibly erases their entire arrears history** — the record of money they owed the club. `member_arrears` also carries `waivedBy` / `waivedReason` (`:15-16`), i.e. it is the audit trail for debt waivers. By contrast `transactions.memberId` (`db/schema/transactions.ts:18`) and `profit_allocations.memberId` (`:11`) correctly use a plain reference (RESTRICT), so the inconsistency is not a deliberate policy. `meeting_attendees` cascade is defensible (attendance is meeting-scoped) but it removes deposit-status evidence. `project_updates` cascade is safe.
- **Fix:** Change `member_arrears.memberId` to a plain `.references(() => members.id)` (RESTRICT). Model member deletion as a soft delete (`members.status = 'inactive'` + a `deleted_at`) so financial history is retained. The codebase already has soft-delete primitives (`transactions.isDeleted`/`deletedAt`/`deletionReason` at `db/schema/transactions.ts:28-31`, and the `deleted_records` soft-delete table).

### [DATA-015] Global (not per-tenant) unique constraints break multi-tenancy and leak email existence — Severity: High
- **Location:** `db/schema/users.ts:8`, `db/schema/members.ts:8,10`, `db/schema/funds.ts:12`
- **Evidence:**
```ts
// db/schema/members.ts
  memberId: varchar('member_id', { length: 50 }).unique().notNull(),
  email: varchar('email', { length: 255 }).unique().notNull(),
```
```ts
// db/schema/funds.ts:12
  accountNumber: varchar('account_number', { length: 255 }).unique(),
```
- **Impact:** `users.email`, `members.email`, `members.member_id` and `funds.account_number` are unique **across the whole database**, not per tenant. On a multi-tenant SaaS this means: (a) tenant B cannot onboard a member with the same `member_id` or email as tenant A — a hard functional ceiling; (b) two tenants sharing a bank account number (common: a shared corporate treasury or a common payout account) cannot both create the fund; (c) the uniqueness violation is itself an **oracle for cross-tenant email existence** — a registration flow that reports "email already registered" discloses that a specific person is a member of a *different* tenant. Contrast with the correct pattern already used for `system_settings` (`unique('uq_system_settings_tenant').on(table.tenantId)`, `db/schema/system_settings.ts:67`) and `tenant_subscriptions` (`db/schema/subscriptions.ts:35`).
- **Fix:** Drop the single-column `.unique()` and replace with composite constraints: `unique('uq_users_tenant_email').on(table.tenantId, table.email)`, `unique('uq_members_tenant_member_id').on(table.tenantId, table.memberId)`, `unique('uq_members_tenant_email').on(table.tenantId, table.email)`, `unique('uq_funds_tenant_account').on(table.tenantId, table.accountNumber)`. Migration must dedupe existing cross-tenant collisions before adding the constraints.

### [DATA-016] `realign-member-shares.mjs` silently guesses the share value and writes outside a transaction — Severity: High
- **Location:** `scripts/realign-member-shares.mjs:63-71`, `:90`, `:100-102`
- **Evidence:**
```js
const DEFAULT_SHARE_VALUE_CENTS = 100_000; // 1000.00 BDT per share
...
  const shareValueCents = centsByTenant.get(member.tenant_id) ?? DEFAULT_SHARE_VALUE_CENTS;
  const expected = Math.floor(toCents(member.total_contributed) / shareValueCents);
```
```js
    if (!DRY) {
      await sql`update members set shares = ${expected}, updated_at = now() where id = ${member.id}`;
    }
```
- **Impact:** Two defects in one money-critical script. (a) If a tenant has no `system_settings` row (or a NULL `tenant_id`), the script **silently assumes 1000.00 BDT per share** and rewrites `members.shares` from that guess — recomputing ownership percentages and therefore profit-allocation entitlements from an unverified constant. Note the script's own guard at `:67-69` throws for a non-positive configured value, but the `?? DEFAULT` path bypasses the guard entirely. (b) The updates run in **autocommit, one row at a time**, with no `BEGIN`/`COMMIT`, no `updated_by`, and no `audit_logs` row. A crash, a dropped connection, or a `Ctrl-C` mid-loop leaves members **partially realigned** with no record of the change. The `WHERE id = ...` also has no `tenant_id` guard.
- **Fix:** Replace the `??` fallback with a hard `throw` when `centsByTenant` has no entry for `member.tenant_id`. Wrap the apply path in `sql.begin(async (tx) => { ... })`. Add `and(eq(tenantId, member.tenant_id))` to the update and write an `audit_logs` entry per changed member (or one summary row) recording the old and new share count.

---

### [DATA-017] Runtime DDL executed on every database connection — Severity: Medium
- **Location:** `server/src/config/database.ts:37-46`
- **Evidence:**
```ts
      // Auto-migrate critical schema columns if needed
      try {
        await sql`ALTER TABLE global_stats_trends ADD COLUMN IF NOT EXISTS deposit numeric(15, 2) DEFAULT '0'`;
        await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS mother_name varchar(255)`;
        await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS spouse_name varchar(255)`;
      } catch {
        // Non-blocking if tables not yet created
      }
```
- **Impact:** Three `ALTER TABLE` statements run on **every** connection attempt (up to 5 retries, `server/src/config/database.ts:26`), inside the app's boot path, outside the migration system. Under a Supabase transaction-mode pooler this holds a pool slot and an `ACCESS EXCLUSIVE` lock per statement. The bare `catch {}` swallows failures, so a least-privilege DB role without DDL rights produces a permanently "migrated" database that silently never receives the columns. These three columns *are* in the root schema (`db/schema/global_stats.ts:20`, `db/schema/members.ts:32-33`) — so this is a third schema-mutation mechanism alongside `db:push` and the hand-written SQL.
- **Fix:** Delete the block. Express all three columns as a proper drizzle-kit migration. Legacy-tree only, so the fix is part of retiring `server/src/`.

### [DATA-018] Missing unique constraints permit duplicate money rows — Severity: Medium
- **Location:** `db/schema/member_arrears.ts:19-23`, `db/schema/profit_allocations.ts:20-25`, `db/schema/fiscal_periods.ts:26-30`
- **Evidence:**
```ts
// db/schema/member_arrears.ts:20-23 — no unique on (memberId, periodKey)
  index('idx_arrears_tenant').on(table.tenantId),
  index('idx_arrears_member_period').on(table.memberId, table.periodKey),
  index('idx_arrears_status').on(table.status),
```
```ts
// db/schema/fiscal_periods.ts:26-30 — no unique on (tenantId, year) or (tenantId, periodStart)
  index('idx_fiscal_tenant').on(table.tenantId),
  index('idx_fiscal_year').on(table.year),
  index('idx_fiscal_status').on(table.status),
```
- **Impact:** Nothing prevents two arrears rows for the same `(memberId, periodKey)` — a double-insert (retry, concurrent request, no transaction) doubles the recorded shortfall. Nothing prevents two `profit_allocations` rows for the same `(fiscalPeriodId, memberId, allocationType)` — **the same member's profit being allocated twice**, with no constraint to catch it. Nothing prevents two `fiscal_periods` for the same tenant+year, so a double year-end close creates duplicate statutory-reserve and distributable-surplus figures. All three tables hold real money; all three have only non-unique indexes.
- **Fix:** `unique('uq_arrears_member_period').on(table.memberId, table.periodKey)`, `unique('uq_allocation_period_member_type').on(table.fiscalPeriodId, table.memberId, table.allocationType)`, `unique('uq_fiscal_tenant_year').on(table.tenantId, table.year)`. Apply `ALTER TABLE … ADD CONSTRAINT` with a preceding dedupe step.

### [DATA-019] No CHECK constraints on any money, quantity, or status column — Severity: Medium
- **Location:** `db/schema/transactions.ts:12,24-25`, `db/schema/members.ts:13,22`, `db/schema/funds.ts:13`, `db/schema/fiscal_periods.ts:9-11`, `db/schema/meetings.ts:14`, `db/schema/member_penalties.ts:14-16,22`
- **Evidence:**
```ts
// db/schema/transactions.ts:12 — no CHECK (amount >= 0)
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
  ...
  balanceBefore: decimal('balance_before', { precision: 15, scale: 2 }),
  balanceAfter: decimal('balance_after', { precision: 15, scale: 2 }),
```
```ts
// db/schema/funds.ts:13 — no CHECK (balance >= 0)
  balance: decimal('balance', { precision: 15, scale: 2 }).default('0').notNull(),
```
```ts
// db/schema/member_penalties.ts:14-16 — free-form tier and type
  tier: integer('tier').notNull(),          // 1, 2, 3, 4  (comment only, not a constraint)
  type: varchar('type', { length: 50 }).notNull(),  // VERBAL_WARNING | FUND_DEDUCTION | SUSPENSION
```
- **Impact:** The permitted value sets for `tier`, `type`, `status`, `attendanceStatus`, `depositStatus`, `allocationType` and `transaction.type` exist **only in TypeScript comments** (`member_penalties.ts:14-16,22`; `meetings.ts:14`; `db/schema/meeting_attendees.ts:11-12`; `transactions.ts:11,17`). A typo, a bad migration, or a hand-edited row writes `'warning'` instead of `'VERBAL_WARNING'` and every `WHERE status = 'VERBAL_WARNING'` query silently misses it. Money columns accept negatives, so a `funds.balance` can go negative (overdraft) and a `transactions.amount` can be negative where a refund is not intended. `fiscalPeriods` has no `periodEnd > periodStart` check, so an inverted fiscal year is representable.
- **Fix:** Add `check('chk_transactions_amount_nonneg', sql\`${table.amount} >= 0\`)`-style constraints for `transactions.amount`, `funds.balance`, `members.shares >= 0`, `members.totalContributed >= 0`, `member_penalties.tier BETWEEN 1 AND 4`, `fiscalPeriods.periodEnd > periodStart`, and enum CHECKs for every enumerated `varchar`. Add them in a new migration (validators are declarative in the Drizzle schema, so `generate` will pick them up).

### [DATA-020] `/api/backup/restore` returns `success: true` for an operation that does nothing — Severity: Medium
- **Location:** `app/api/backup/restore/route.ts:22-33`
- **Evidence:**
```ts
    const body = await request.json();
    const { backupKey } = body;

    if (!backupKey) {
      return NextResponse.json({ success: false, message: 'backupKey is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // In production, this would download from R2 and restore.
    return NextResponse.json({ success: true, status: 'restore_queued' });
```
- **Impact:** `backupKey` is accepted, **never validated** (no prefix allowlist, no traversal check, no existence check), and the handler returns `success: true, status: 'restore_queued'`. An operator who clicks Restore in the UI sees a success toast and believes their data is recovered when nothing happened. The sibling `list` route has the same shape (`app/api/backup/list/route.ts:23` — `return NextResponse.json({ success: true, backups: [] })`), so the UI will render an empty backup list rather than an error, hiding the fact that the in-app backup feature is entirely non-functional. Both routes are undocumented as stubs while `docs/BACKUP_RESTORE_FEATURE.md` and `docs/BACKUP_SETUP_GUIDE.md` are committed.
- **Fix:** Return `501 Not Implemented` with an explicit `code: 'NOT_IMPLEMENTED'` and surface the R2 workflow name in the message, so the UI shows a truthful "run the *Database Restore* GitHub workflow" instruction. Until then, remove the routes and their UI affordance.

### [DATA-021] Cron backup performs an unbounded full-table dump and discards it — Severity: Medium
- **Location:** `app/api/backup/route.ts:24-52`
- **Evidence:**
```ts
    const cronSecret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');
    if (!cronSecret || !auth || auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ success: false, message: 'Invalid or missing cron secret' }, { status: 401 });
    }

    const backup = await performBackup();
    console.log(`[cron] Backup completed: ${TABLES.length} tables at ${new Date().toISOString()}`);
```
- **Impact:** This is a **cost/DoS amplifier, not a backup**: it materializes 13 full tables (including every `transactions` row) into a JS object, then throws it away and returns `{ success: true }` with no artifact. In a serverless function this will OOM or exceed the execution limit on a real dataset — producing exactly the "backup succeeded" green that masks the failure. There is no `vercel.json` `crons` entry (`vercel.json:1-3` is only `{"framework":"nextjs"}`), so nothing ever calls this endpoint in the first place. `auth !== \`Bearer ${cronSecret}\`` is also a non-constant-time comparison, and there is no rate limit.
- **Fix:** Delete the route — the real backup pipeline is `db-backup-r2.yml` using `pg_dump`. If an in-app trigger is required, stream rows per table and write to R2 rather than materializing, cap total rows, and return the artifact key. Use `crypto.timingSafeEqual` for the secret compare.

### [DATA-022] Fiscal period boundaries are `timestamptz` rather than `date` — Severity: Medium
- **Location:** `db/schema/fiscal_periods.ts:9-10`
- **Evidence:**
```ts
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
```
- **Impact:** A fiscal period is a **calendar-date range**, not an instant. Storing it as `timestamptz` means `periodStart` denotes a different calendar day depending on the session timezone — a period written as `2025-07-01T00:00+06:00` reads back as `2025-06-30` for a UTC-based reporting query. For statutory reserve and distributable-surplus calculations (`fiscal_periods.ts:17-20`) that is a one-day boundary shift in a fiscal close. The rest of the schema gets this right: `projects.startDate`/`completionDate` and `goals.deadline` use `date()` (`db/schema/projects.ts:17-18`, `db/schema/goals.ts:14`). `meetings.meetingDate` is correctly `timestamptz` (`db/schema/meetings.ts:9`) because a meeting *is* an instant.
- **Fix:** `periodStart: date('period_start').notNull()` / `periodEnd: date('period_end').notNull()`. Migrate with `ALTER TABLE fiscal_periods ALTER COLUMN period_start TYPE date USING period_start::date` after confirming no intraday times are meaningful.

### [DATA-023] No environment validation at startup; undocumented required variables — Severity: Medium
- **Location:** `db/index.ts:38-44`, `lib/utils/jwt.ts:33`, `lib/edge-auth.ts:21-22`, `.env.example`
- **Evidence:**
```ts
// db/index.ts:38 — presence-only check, no format, no sslmode enforcement
function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return url;
}
```
```ts
// lib/utils/jwt.ts:33 — refresh secret requires >= 16 chars, but JWT_SECRET has NO minimum
    const refreshSecret = process.env.JWT_REFRESH_SECRET;
    if (refreshSecret && refreshSecret.length >= 16) {
      return refreshSecret;
    }
```
```yaml
# .env.example — SUPERADMIN_PASSWORD is never mentioned
# JWT signing secrets (min 16 chars each). Access tokens live 15m, refresh 7d.
JWT_SECRET="<change-me-to-a-long-random-string>"
```
- **Impact:** The **live app has no env validation module at all** — the only zod schema (`server/src/config/env.ts:9-24`, which requires `JWT_SECRET.min(32)`, `DATABASE_URL.url()`, and a typed `NODE_ENV`) lives in the dead legacy tree. Consequences: (a) a short `JWT_SECRET` (`'a'`) is accepted and both access tokens and the derived refresh secret are signed with it — `.env.example` says "min 16 chars" but nothing enforces it; (b) `DATABASE_URL` is never format-validated, so a malformed or non-TLS DSN silently connects to the wrong database or over plaintext; (c) `.env.example` omits `SUPERADMIN_PASSWORD` (see DATA-005) and **all five `R2_*` variables** used by `.github/workflows/db-backup-r2.yml:62-65` and by both R2 scripts, so an operator provisioning from the template has no signal that backups are configured.
- **Fix:** Add `lib/env.ts` exporting a zod-parsed, `process.exit(1)`-on-failure schema (port `server/src/config/env.ts` and extend it with `SUPERADMIN_PASSWORD`, `R2_*`, `SUPERADMIN_EMAILS`). Require `JWT_SECRET.min(32)`. Import it from `instrumentation.ts` so boot fails fast in every runtime, including edge. Add every referenced variable to `.env.example`.

### [DATA-024] `next lint` is deprecated and removed in Next 16 — Severity: Medium
- **Location:** `package.json:10`
- **Evidence:**
```json
    "lint": "next lint",
```
Installed: `next@15.5.26`, `eslint@9.39.5`, `eslint-config-next@^15.1.0`. Config: `.eslintrc.json` (untracked, legacy format).
- **Impact:** `next lint` was deprecated in Next 15.5 and **removed in Next 16**. The caret range `"next": "^15.1.0"` permits an unattended `npm install` to resolve 16.x, at which point `npm run lint` fails outright and any CI calling it breaks. Separately, `eslint-config-next@^15.1.0` is not pinned to the installed `next` minor. Note the CLAUDE.md instruction "Run Linting (`npm run lint` on server)" points at `server/package.json`'s `eslint src/` — a different linter on a dead tree.
- **Fix:** Migrate to ESLint CLI directly (`"lint": "eslint . --max-warnings=0"`) with a flat `eslint.config.mjs`, or pin `"next": "~15.5.26"` until the flat-config migration is done. Add `.eslintrc.json` to `.gitignore`/remove it once flat config lands.

### [DATA-025] No security response headers, despite documentation claiming they exist — Severity: Medium
- **Location:** `next.config.ts:3-15`
- **Evidence:**
```ts
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  webpack(config) { ... },
};
```
- **Impact:** `next.config.ts` sets `poweredByHeader: false` (good) and nothing else — **no** `async headers()` block, therefore no `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, or `X-Content-Type-Options`. The repo tracks `docs/SECURITY_HEADERS_IMPLEMENTATION.md` and `docs/SECURITY_FIXES_APPLIED.md`, which creates false assurance that the control exists. `vercel.json` (`{"framework":"nextjs"}`) adds no headers either. There is also no `serverExternalPackages: ['postgres']`, so the `postgres` driver is bundled into the serverless function rather than kept external.
- **Fix:** Add an `async headers()` block returning the HSTS/CSP/nosniff/frame/referrer set. Either implement the headers or delete the two docs that assert they are in place. Add `serverExternalPackages: ['postgres', 'bcryptjs']`.

### [DATA-026] `vercel.json` has no region and no crons; DB latency floor is unaddressed — Severity: Medium
- **Location:** `vercel.json:1-3`
- **Evidence:**
```json
{
  "framework": "nextjs"
}
```
- **Impact:** (a) No `regions` — the function runs in Vercel's default region while `DATABASE_URL` points at a Supabase pooler (`.env.example:5`); every query pays a cross-region round trip. `db/index.ts:16-21` documents exactly this failure mode ("a remote-database latency floor is visible at a glance. Sustained 200-300ms per trivial query means the database region — not the SQL — is the bottleneck") but the config never pins it. (b) No `crons` — `CRON_SECRET` and the `/api/backup` cron endpoint (`app/api/backup/route.ts:23`) exist but are never scheduled, so the documented backup path is dead in production. (c) No `functions` block, so `/api/backup` inherits the Hobby-tier default duration and will time out mid-dump (see DATA-021). Note `server/vercel.json` is a *different* config routing all traffic to the dead `/api/index.js`.
- **Fix:** Add `{"framework":"nextjs","regions":["<db-region>"],"functions":{"app/api/backup/route.ts":{"maxDuration":60}}}` and either add a `crons` entry or delete the `CRON_SECRET` mechanism and the route. Delete `server/vercel.json` with the rest of the legacy tree.

### [DATA-027] Duplicated root + `server/` configuration sets — Severity: Medium
- **Location:** root vs `server/`
- **Evidence:**
| File | Root | `server/` |
|---|---|---|
| `drizzle.config.ts` | `./db/schema/index.ts` → `./db/migrations` | `./src/db/schema/*.ts` → `./drizzle` |
| `package.json` | `investwise-next`, 17 deps | separate tree, 117 files, own `pino`/`supabase`/`cors` |
| `tsconfig.json` | Next.js root | legacy server |
| `vitest.config.ts` | present | present |
| `vercel.json` | `{"framework":"nextjs"}` | routes everything to `/api/index.js` |
| `.env.example` | present | present, different variables |
| `.gitignore` | present | present (nested, overlapping) |

Plus two parallel DB pools (`db/index.ts:87-97` and `server/src/lib/db.ts:22-32`) and two `setAppContext` implementations.
- **Impact:** Seven duplicated config files, two schema definitions, two migration folders, two package manifests, two env templates, two gitignores, two DB pools, two RLS helpers. Every finding in this report is a direct consequence of this duplication — an operator following `CLAUDE.md` lands in `server/` and operates on the stale schema. A future `npm ci` in `server/` pulls a second copy of the dependency tree.
- **Fix:** Retire `server/` wholesale (it is not wired in) and add a single root `AGENTS.md` note pointing all DB commands at the root. If `server/` must be kept short-term for history, add it to `.gitignore` paths and to a CI denylist so it is not built, linted, or deployed.

### [DATA-028] Hand-written migrations in a drizzle-kit-managed repo — Severity: Medium
- **Location:** `db/migrations/0001_multitenant_foundation.sql`, `db/migrations/0002_rbac_remove_access_level.sql`, `server/drizzle/meta/_journal.json`
- **Evidence:** `db/migrations/` has two hand-authored SQL files and **no** `meta/_journal.json` or `meta/*_snapshot.json`. `server/drizzle/` has a proper drizzle-kit journal:
```json
{ "version": "7", "dialect": "postgresql",
  "entries": [ { "idx": 0, "version": "7", "when": 1786561339232, "tag": "0000_silly_hercules", "breakpoints": true } ] }
```
- **Impact:** The only machine-tracked migration history belongs to the **dead** tree. The live tree's SQL is hand-written and deliberately idempotent (`db/migrations/0001_multitenant_foundation.sql:3` — *"Re-runnable: every statement is IF NOT EXISTS / ON CONFLICT DO NOTHING guarded"*), which means it is **order-independent by design** — and that in turn means a future `drizzle-kit generate` snapshot has no baseline to diff against and will emit a full re-`CREATE`. There is no applied-migrations ledger, so there is no way to ask a deployed database "which migrations have you run?" (a `drizzle.__drizzle_migrations` table would answer it; it does not exist).
- **Fix:** Adopt one system. Either (a) run `drizzle-kit generate` to bootstrap a real journal + base migration and express the tenancy/RBAC work as generated migrations, or (b) commit a hand-rolled `schema_migrations` ledger table with the 0001/0002 hashes and a `db:migrate` runner that applies files in filename order and records each. Do not leave two coexisting conventions.

### [DATA-029] Business tables with no `tenantId` — Severity: Medium
- **Location:** `db/schema/global_stats.ts:3-14`, `db/schema/deleted_records.ts:4-13`, `db/schema/projects.ts:51-59`
- **Evidence:**
```ts
// db/schema/global_stats.ts:3-14 — money aggregates in a single global row, no tenantId
export const globalStats = pgTable('global_stats', {
  id: uuid('id').defaultRandom().primaryKey(),
  totalDeposits: decimal('total_deposits', { precision: 15, scale: 2 }).default('0'),
  investedCapital: decimal('invested_capital', { precision: 15, scale: 2 }).default('0'),
  ...
```
```ts
// db/schema/deleted_records.ts:4-13 — full deleted-row snapshot, no tenantId
export const deletedRecords = pgTable('deleted_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  originalId: varchar('original_id', { length: 255 }).notNull(),
  collectionName: varchar('collection_name', { length: 100 }).notNull(),
  data: jsonb('data').notNull(),
```
```ts
// db/schema/projects.ts:51-55 — equity/ownership junction, no tenantId
export const projectMembers = pgTable('project_members', {
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  memberId: uuid('member_id').references(() => members.id, { onDelete: 'cascade' }).notNull(),
  sharesInvested: integer('shares_invested').default(0),
```
- **Impact:** `global_stats` holds **money aggregates** (`totalDeposits`, `investedCapital`, `totalShares`, `totalMembers`) in a single global row with no tenant scope — every tenant's dashboard reads the same global figures, and a tenant-scoped query cannot filter them. `deleted_records.data` is a full JSONB snapshot of any deleted row (i.e. a second, unscoped copy of member PII) with no `tenantId`, so a tenant-scoped soft-delete listing leaks other tenants' deleted rows and there is no way to purge one tenant's data on offboarding. `project_members` is the ownership/equity junction (share counts and `ownershipPercentage`) and cannot be queried per tenant. `sessions`, `login_attempts` and `blacklisted_tokens` also lack `tenantId` but are reachable via `userId`, so they are acceptable.
- **Fix:** Add `tenantId` (FK → `tenants.id`, `NOT NULL` after backfill, indexed) to `global_stats`, `deleted_records`, and `project_members`, plus a composite unique on `global_stats (tenant_id)` and `project_members (tenant_id, project_id, member_id)`. Backfill existing rows to the default tenant. Then enforce the same rule with RLS (DATA-006) so the next omission is impossible.

### [DATA-030] Tracked `.mcp.json` leaks the production Supabase project ref and the OS username — Severity: Medium
- **Location:** `.mcp.json:5`, `:15-22` (tracked; 10-line uncommitted diff pending)
- **Evidence:**
```json
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=vcfofbnkwzjimfonzooz&features=storage%2Cbranching%2Cfunctions%2Cdevelopment%2Cdebugging%2Cdatabase%2Caccount%2Cdocs"
    },
```
```json
    "codemesh": {
      "command": "c:\\Users\\mhass\\.antigravity-ide\\extensions\\codemesh.vscode-codemesh-0.4.312-universal\\bin\\win32-x64\\codemesh.exe",
      "env": {
        "CODEMESH_SCOPE_ROOT": "d:\\my project\\Investwise_app_source_code\\investwise_web_app"
      }
    }
```
- **Impact:** No access token is present (the MCP server uses OAuth, not an embedded key — confirmed by reading the full redacted file). But `project_ref=vcfofbnkwzjimfonzooz` is the **production database project identifier**, visible to anyone with repo read access, and combined with the other `features` parameters it maps the exact capability set enabled on that project. The `codemesh` block additionally discloses the OS username (`mhass`), an absolute path into a personal IDE extension install, and the developer's local repo root. None of this belongs in version control.
- **Fix:** Add `.mcp.json` to `.gitignore` and `git rm --cached .mcp.json`, shipping a `.mcp.json.example` with placeholders instead. Confirm `project_ref` is not reused as a credential anywhere (it is a public identifier, not a secret, so this is disclosure rather than compromise).

### [DATA-031] Local tool directories are untracked but not gitignored — Severity: Medium
- **Location:** `.gitignore:217-235`
- **Evidence:**
```
$ git check-ignore -v .wrangler .commandcode .freebuff .workbuddy-ai .arts
(no output — none are ignored)
$ git status --porcelain | grep '^??'
?? .arts/  ?? .commandcode/  ?? .freebuff/  ?? .workbuddy-ai/  ?? .wrangler/
```
- **Impact:** `.gitignore:220-235` covers `.gemini/`, `.antigravityignore`, `.vercel/`, `.codegraph/`, `.codegraphignore`, `.claude/`, `.lingma/`, `.mimocode/`, `.agent(s)/`, `_agent(s)/`, `skills-lock.json` — but **not** `.wrangler/`, `.commandcode/`, `.freebuff/`, `.workbuddy-ai/`, or `.arts/`. All five are currently untracked and would be swept into the next `git add -A`. `.wrangler/` in particular holds the **Cloudflare Wrangler local state** (and can contain R2/D1 credentials in `wrangler.toml` dev secrets or `.wrangler/state`). `skills-lock.json` is listed in `.gitignore:235` but is **already tracked** (it appears in `git ls-files`), so the ignore rule is inert.
- **Fix:** Add the five directories to `.gitignore`, verify `.wrangler` contains no cached secrets, and run `git rm --cached skills-lock.json` so its ignore rule takes effect.

### [DATA-032] `sql.unsafe` string interpolation and SQL text in stdout logs — Severity: Medium
- **Location:** `app/api/backup/route.ts:17`, `db/index.ts:22-32`, `db/index.ts:63`
- **Evidence:**
```ts
    const rows = await sql.unsafe(`SELECT * FROM ${table}`);
```
```ts
// db/index.ts:22,28-31 — opt-in, but unbounded
const logTiming = process.env.DB_LOG_TIMING === '1';
...
      onquery: (query: { string?: string; duration?: number }) => {
        const preview = (query.string || '').replace(/\s+/g, ' ').slice(0, 90);
        console.log(`[DB] ${query.duration?.toFixed(0) ?? '?'}ms  ${preview}`);
      },
```
```ts
// db/index.ts:63
      console.error(`[ERROR] Connection attempt ${attempt}/${maxAttempts} failed:`, error);
```
- **Impact:** (a) `sql.unsafe` with template interpolation is the injection-shaped pattern; the table list is currently a hardcoded const so it is not directly exploitable, but it is one refactor away from being a hole, and `unsafe` additionally disables postgres.js's prepared-statement caching. (b) `DB_LOG_TIMING` writes the first 90 characters of **every** statement to stdout, unbounded, in a serverless environment — any query that inlines a value (rather than parameterizing) leaks PII or a token into the log store. (c) `console.error(..., error)` on connect failure passes the raw error object; whether `postgres.js` includes the connection string in its error message determines whether `DATABASE_URL` (with its password) lands in logs. **Needs verification:** reproduce a failed connection against a host:port with credentials and inspect the serialized error for the DSN.
- **Fix:** Replace `sql.unsafe` with `sql\`SELECT * FROM ${sql(table)}\`` using postgres.js's identifier helper. Gate `onquery` behind `NODE_ENV !== 'production'` in addition to `DB_LOG_TIMING`, and log only the duration and a statement fingerprint (`substring(0,40)` of the *normalized* query with literals already parameterized). Log `err.code` and `err.message` explicitly rather than the whole error object.

### [DATA-033] Backup dumps and `restore.dump` are not gitignored — Severity: Medium
- **Location:** `.gitignore:71-80`, `:129-137`
- **Evidence:**
```
.gitignore:73:*.zip   .gitignore:74:*.tar.gz   .gitignore:75:*.rar
.gitignore:76:*.7z    .gitignore:77:*.exe     .gitignore:78:*.msi
```
No `*.dump` / `*.sql.gz` / `*.backup` / `*.tar` pattern exists. (`.gitignore:136 *.backup` covers a different extension than the workflow's `.dump`.)
- **Impact:** `db-backup-r2.yml:45` names its artifact `investwise-backup-<ts>.dump` and `r2-restore-download.js:35` writes `./restore.dump` — both into the repository working directory. A local run of either workflow, or a `pg_dump` run by hand from the repo root, leaves a **full unencrypted database dump containing password hashes and PII** as an untracked-but-not-ignored file, one `git add -A` away from being committed. `git check-ignore` confirms neither pattern matches.
- **Fix:** Add `*.dump`, `*.sql.gz`, `*.tar.gz` (already present), `restore.dump`, and `backups/` to `.gitignore`. Better, write artifacts to a path outside the repo (`$RUNNER_TEMP` in CI) so they cannot be staged at all.

### [DATA-034] Documentation asserts backup and security features that do not exist — Severity: Medium
- **Location:** `docs/BACKUP_RESTORE_FEATURE.md`, `docs/BACKUP_SETUP_GUIDE.md`, `docs/BACKUP_QUICK_START.md`, `docs/SECURITY_HEADERS_IMPLEMENTATION.md`, `docs/SECURITY_FIXES_APPLIED.md`
- **Evidence:** `app/api/backup/restore/route.ts:32` — `// In production, this would download from R2 and restore.`; `app/api/backup/list/route.ts:22` — `// In production, this would list from R2. For now, return empty.`; `next.config.ts:3-15` — no `headers()` block.
- **Impact:** Five committed documents describe an in-app R2 backup list, an in-app restore, and a security-headers implementation. None of it exists in the code. An engineer or auditor who reads `docs/SECURITY_HEADERS_IMPLEMENTATION.md` and checks `next.config.ts` will conclude the control was removed rather than never landed — the more dangerous reading. This is also why DATA-001 and DATA-020 have survived: the feature is documented as working.
- **Fix:** Either implement or mark the docs `STATUS: NOT IMPLEMENTED` with a pointer to the actual mechanism (`db-backup-r2.yml` / `db-restore-r2.yml`). Add a CI check that fails when a doc under `docs/` claims a shipped feature absent from the code.

### [DATA-035] Minor hygiene and drift — Severity: Low
- **`.env.example:14` references a dropped column:** `# Bootstrap superadmin account email (seeded in users with access_level 5).` — `access_level` was dropped by `db/migrations/0002_rbac_remove_access_level.sql:50`. Update the comment to reference `role = 'SuperAdmin'`.
- **Hand-rolled `.env` parsers** in `scripts/seed-superadmin.mjs:20-31` and `scripts/realign-member-shares.mjs:31-42` (duplicated): the regex `/^\s*([A-Za-z_][\w]*)\s*=\s*(.*)\s*$/` does not handle `export KEY=`, inline `#` comments (a `#` inside a quoted password survives stripping only the outer quotes), CRLF (the `\r` is absorbed into the value by `.*\s*$` then `.trim()`ed — safe here by luck), or multi-line values. Use `dotenv` (already a dependency) or `process.loadEnvFile()`.
- **`vitest.config.ts:15` excludes only 1 of 5 legacy test files:** `server/src/__tests__/api-smoke.test.ts` is excluded, but `features.test.ts`, `governance.test.ts`, `health.test.ts` and `pagination-limits.test.ts` are not, so the reported 69/69 baseline includes dead Express tests. Exclude `server/**` wholesale, or delete the legacy tests.
- **`server/vercel.json`** still routes **all** traffic to `/api/index.js` (the dead serverless entry). If this config is ever picked up by a Vercel project it will shadow the Next.js app. Delete with the legacy tree.
- **No pool shutdown on the live path:** `db/index.ts:87-97` creates a pool lazily per cold start with `max_lifetime: 60 * 3` (180s) and there is no `sql.end()` anywhere; `instrumentation.ts:12-17` treats a boot failure as non-fatal. Contrast `server/src/lib/db.ts:40-46` which at least exposes `closeDb()`. On serverless this is mostly harmless, but it means the documented retry loop (`:53-82`, 5 attempts × 2s) can add ~8s of latency to the first request after a cold start during a database blip.

---

## Secret exposure summary (values redacted)

**No committed secrets found.** Verified via `git ls-files`, `git check-ignore -v`, and a repo-wide pattern scan for JWTs (`eyJ…`), AWS keys (`AKIA…`), `PEM` private-key headers, Supabase `service_role` tokens, and `postgresql://user:pass@` literals. The only connection-string literals present are local-development placeholders.

| Location | Value | Status |
|---|---|---|
| `server/drizzle.config.ts:8` | `postgresql://postgres:password@localhost:5432/postgres` — **value redacted** (local placeholder) | Low — inert, but a silent fallback: `npm run db:push` with `DATABASE_URL` unset targets local Postgres rather than failing |
| `server/src/db/init-db.ts:137` | `postgresql://postgres:postgres@localhost:5432/investwise` — **value redacted** (console hint) | Low — printed to stdout on init |
| `.env.example:5,8,9,12` | `change-me-to-a-long-random-string` — **value redacted** (explicit placeholder) | Correctly a placeholder |
| `scripts/seed-superadmin.mjs:41` | `'pass-12345678'` — a **real, hardcoded default credential** for the platform SuperAdmin | **Critical — see DATA-005** |
| `.mcp.json:5` | `project_ref=vcfofbnkwzjimfonzooz` — Supabase production project identifier (public, not a secret) | Medium — see DATA-030 |

**Untracked-but-present on disk, correctly ignored:** `server/.env`, `server/.env.local`, `server/dist/`, `server/node_modules/`. `git ls-files` confirms none are tracked. `.gitignore` covers `.env`, `.env.local`, `.env.{development,test,production}[.local]`, `*.env`, `server/.env`, and a final catch-all `.env*` (`:16-25`, `:242`), plus `dist/`, `build/`, `*.log`, `logs/`, `*.pem`, `*.key`, `*.p12`, `secrets/`, `credentials/` (`:30-48`, `:156-164`). `server/.gitignore` independently covers the same set. **No `*.log`, no `server/dist`, and no `.env` file is tracked.**

**Gap:** `.gitignore:165-166` ignores `docs/R2_CONFIGURATION.md` and `docs/*_CONFIGURATION.md`. That is a *workaround* for real R2 credentials in docs rather than a fix — those documents should be written to use placeholders and tracked, so operators can actually read them.

**Also unignored:** `*.dump` / `restore.dump` (DATA-033), and `.wrangler/`, `.commandcode/`, `.freebuff/`, `.workbuddy-ai/`, `.arts/` (DATA-031).

---

## CI/CD risk list

| # | Workflow | Finding | Severity | Ref |
|---|---|---|---|---|
| 1 | *(none)* | **No CI exists for the live app.** `app/**`, `lib/**`, `db/**`, `components/**`, `middleware.ts`, `*.config.ts` trigger no workflow. | High | DATA-011 |
| 2 | `frontend-ci.yml` | Targets `client/**`, which **does not exist on disk** and is 113 unstaged deletions. Fails at `cache-dependency-path: client/package-lock.json`. | High | DATA-011 |
| 3 | `backend-ci.yml` | Gates on `server/**`, the tree explicitly not wired into the running app. Green checks on dead code. | High | DATA-011 |
| 4 | `db-restore-r2.yml:63-68` | `pg_restore --clean --if-exists … \|\| true` then reports "Restored successfully" — **swallowed destructive-restore failure**. | **Critical** | DATA-002 |
| 5 | `db-restore-r2.yml:21`, `:75` | `${{ github.event.inputs.* }}` interpolated directly into `run:` — **script injection** with `R2_SECRET_ACCESS_KEY` + `DATABASE_URL` in scope. | High | DATA-012 |
| 6 | `db-restore-r2.yml:53` | `backup_file` reaches `r2-restore-download.js:27` with no allowlist, traversal, or integrity check, then drives `pg_restore --clean`. | High | DATA-010 |
| 7 | all 4 workflows | **No `permissions:` block** → default `GITHUB_TOKEN` scope (potentially read/write). | High | DATA-013 |
| 8 | all 4 workflows | **No `concurrency:` group** → scheduled backup can race a restore and race itself on the `backups/latest.dump` pointer. | High | DATA-013 |
| 9 | all 4 workflows | Actions pinned to mutable tags (`actions/checkout@v4`, `actions/setup-node@v4`), **not commit SHAs** — supply-chain exposure with `DATABASE_URL` in scope. | High | DATA-013 |
| 10 | `db-backup-r2.yml:29`, `db-restore-r2.yml:36` | `npm install @aws-sdk/client-s3 --no-save` — unpinned, no lockfile, no integrity hash, resolved fresh each run. | Medium | DATA-013 |
| 11 | `db-backup-r2.yml:68`, `db-restore-r2.yml:54` | `NODE_PATH: server/node_modules` points into the legacy tree, which is never installed in these jobs. | Medium | DATA-013 |
| 12 | `db-backup-r2.yml:50-54` | `pg_dump` of the full database uploaded to R2 with **no encryption at rest** — contains bcrypt hashes, raw bearer tokens, NID/passport. | High | DATA-009 |
| 13 | `db-backup-r2.yml:50-54`, `r2-restore-download.js:35` | Artifacts land in the repo working directory; `*.dump` is not gitignored. | Medium | DATA-033 |
| 14 | `db-restore-r2.yml` (all) | No pre-restore snapshot, no `pg_restore --list` preflight, no `--single-transaction`, no checksum verification, no schema-compat check. | High | DATA-002, DATA-010 |
| 15 | — | No `pull_request_target` trigger and no fork-PR secret exposure found. (`on:` is `push`/`pull_request` on `main` only, with path filters.) | *Clean* | — |

---

## What is done right (short)

- **Money is `numeric`, never float.** Every monetary column is Drizzle `decimal` → Postgres `numeric` with explicit `precision`/`scale` (e.g. `amount numeric(15,2)` at `db/schema/transactions.ts:12`, `rate_per_share numeric(15,6)` at `db/schema/profit_allocations.ts:15`). No `float`/`double precision` anywhere. `scripts/realign-member-shares.mjs:44-53` implements exact cents-integer arithmetic with a regex parse, explicitly avoiding float math — a genuinely careful touch.
- **No `serial`.** Every primary key is `uuid().defaultRandom()` — safe for distributed inserts and for a client-sharded multi-tenant deployment.
- **Timestamps are timezone-aware** across the whole schema (`withTimezone: true` on every `timestamp`), and genuine calendar dates use `date()` (`projects.startDate`, `goals.deadline`). The `timestamptz`-vs-`date` choice is correct everywhere except `fiscal_periods` (DATA-022).
- **JWT secrets fail fast.** `lib/utils/jwt.ts:37-39,43-45,55-57` throws `'JWT_SECRET is not set'` rather than falling back to a default, and `lib/edge-auth.ts:22` returns `null` (fail-closed) when the secret is absent. No `dev-secret` fallback anywhere.
- **The refresh secret is derived, not defaulted.** `lib/utils/jwt.ts:40` uses an HMAC of `JWT_SECRET` with a fixed salt when `JWT_REFRESH_SECRET` is absent, so a single configured secret still yields two independent keys.
- **Migrations are non-destructive and idempotent by design.** `db/migrations/0001_multitenant_foundation.sql:3` states the contract and honours it throughout — `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, and a `DO $$ … pg_constraint` guard (`:103-176`) for constraints, since Postgres has no `ADD CONSTRAINT IF NOT EXISTS`.
- **Platform audit survives tenant deletion — by intent.** `db/schema/super_admin_action_log.ts:5-6` documents it and the FKs use `ON DELETE no action` (`:9,14`), so a tenant wipe cannot erase the record of who authorised it.
- **Subscriptions are modelled per-tenant with a unique key.** `db/schema/subscriptions.ts:35` (`unique('uq_tenant_subscriptions_tenant')`) is the correct pattern that `users`/`members` should copy (DATA-015).
- **The tenant index set is thorough on the live schema.** Every `tenantId` in `db/schema/` has a dedicated `idx_*_tenant` index, and `transactions` carries a purpose-built composite set including the 6-month trend path (`db/schema/transactions.ts:35-55`) — the `// Covers the 6-month trend query in analytics` comment shows the indexes were driven by real query shapes, not guesswork.
- **The project has a full-text index.** `db/schema/projects.ts:32` uses a GIN `to_tsvector` index over title/description/category, with the search API and a dedicated `DATE` vs `timestamp` distinction maintained in `projects.startDate`.
- **`.gitignore` blocks every common secret file form**, including the catch-all `.env*` at `:242`, plus key/cert/credential patterns at `:156-164`. No `.env`, `*.log`, or `server/dist` file is tracked.
- **Credentials reach the backup pipeline only via `${{ secrets.* }}` into step-level `env:`** (`db-backup-r2.yml:41-42,61-65`) — never interpolated into a `run:` block. `db/index.ts:29-30` also only logs a 90-char query *prefix* under an explicit opt-in flag, not query parameters.
- **RLS context is at least *plumbed*.** `db/index.ts:114-134` and `server/src/config/database.ts:95-123` both set and — importantly — **reset** `app.user_id` / `app.role` with `set_config(..., true)` (transaction-local) and an explicit `resetAppContext()` to prevent bleed on a pooled connection. The intent and the pooling hazard are both understood; only the policies are missing (DATA-006).
- **The `users_role_check` CHECK constraint and the `access_level` → `role` normalisation are thoughtfully written** (`db/migrations/0002_rbac_remove_access_level.sql:21-50`): the old constraint is dropped *before* normalisation, the platform-operator level is migrated first, unmapped values fall back to the least-privileged role, and every step is existence-guarded.
- **The backup/restore workflow correctly passes secrets via `env:`** (`db-restore-r2.yml:48-53`) and uses `forcePathStyle: true` with `region: 'auto'` for R2 (`r2-backup-upload.js:17-18`) — the commit history (`e70fec1 fix(r2): enable forcePathStyle…`) shows real operational debugging.
- **The legacy tree is genuinely well-built** — the zod env schema (`server/src/config/env.ts:9-33`) is the validation the live app is missing, and the Express modules are worth porting rather than discarding wholesale.
