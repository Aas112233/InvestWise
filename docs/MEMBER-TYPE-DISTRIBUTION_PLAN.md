# Plan — Per-Category Profit/Loss Distribution + Project-Level Members (v7 — SHIPPED)

v6 add-on (same day): **per-project Project Level Member percentage** — see §9.
v7 add-on (same day): **member type locks after the first transaction**, money
types only, Admin override with a written reason — see §10.

Status: **IMPLEMENTED 2026-11-12** — all four phases built and gated
(typecheck 0 errors, lint 0 errors, 773/773 tests, i18n parity for all new
keys; the 45 remaining `i18n:validate` errors are the pre-existing admin-screen
gap logged as ISSUE-001 in `member-type-distribution-test-issues.md`).
Migrations 0027 (`system_settings.distribution_rules`) and 0028
(`members.deposit_cap`) applied to the dev DB.

Implementation deltas vs this blueprint (both verified, not guesses):
1. **Restore route needs no cap guard** — proven: settled ('Completed') deposits
   can never be soft-deleted (the delete desk refuses with `requiresRevertPath`),
   and a reverted deposit re-credits ONLY through the approval route, which IS
   cap-guarded. Covering by proof instead of adding a redundant query.
2. **`POST /api/transactions` needs no cap guard** — its write allow-list
   (`Investment|Withdrawal|Adjustment`) structurally cannot credit a deposit.
3. Dividend payouts carry `role` and the plan carries `typeBlocks`/`remainderCents`
   so the server-driven modal preview shows Type + carve-out chips with zero
   duplicated math on the client.

Follow-up (same day, user review): member-module READ side closed —
`depositCap` added to the directory projection (`MEMBER_FIELDS`);
`cumulativeCreditedDepositsCents` extracted as the exported read-half of
`lib/deposit-cap.ts` (still the ONE owner of the SUM predicate);
`GET /api/members/[id]` adds `cumulativeDeposits` + `boundProjects` for
Project Members only; the detail sheet shows the category chip, a
"Deposit cap / X deposited" tile, and the bound project.

Vocabulary revision (user decision, "those only", migration 0029 applied):
the member categories are now exactly SIX —
`Admin | Manager | Board Member | Shareholder Member | Project Level Member | Auditor`.
`Member`, `Investor`, `Associate Member` and `Founding Member` were folded
into `Shareholder Member` (154 rows remapped; verified 0 retired values
remain) and `Project Member` was renamed `Project Level Member` (still the
single `PROJECT_MEMBER_ROLE` constant). The members.role column default is
`'Shareholder Member'`; every `?? 'Member'` role fallback in both run engines
and both modals follows it. Dashboard: the founding-vs-normal chart was
repurposed to Board vs Shareholder with honest renamed fields
(`boardShares`/`shareholderShares`/`boardMembers`/`shareholderMembers`).
`lib/roles.ts` (login RBAC) is a SEPARATE vocabulary and was intentionally
untouched — its `Member` baseline role is unaffected.

## 1. Confirmed by user (round 1)

1. **Percent semantics = category slice.** Each member category (e.g. A = Board Member,
   B = Normal Shareholder) takes its configured % of the member pool; **inside the category
   the split is pro-rata by share number**.
2. **Every dividend applies the rules** — project returns (profit AND loss legs, including
   settle & close) and the club dividend run.
3. **Loss uses the same category weights** (equity cap + reallocation stay in force).
4. **Project-level member** is a new category with two extra rules:
   - has its own configurable % (in the same settings list) for project returns;
   - cannot receive club dividends "outside the project";
   - a **deposit cap** (max it may deposit into the club) must be set **before/at creation**.
5. **Both legs** (profit + loss) calculate by category % × intra-category share number.
6. **Project member = new exclusive category** — a new role value `Project Member`; no club
   shares, never in club dividend runs; its project share number = its `sharesInvested`.
7. **Deposit cap = cumulative lifetime** — the member's total posted deposits can never exceed
   the cap; withdrawals/refunds do not free it; admin can raise the cap later.
8. **Exactly one project** — a Project Member is bound to a single project; adding them to a
   second project is blocked.

## 2. Current state (verified against the code)

**Distribution — one chain today:**
- Project returns: `POST /api/projects/[id]/distribute-returns` — profit leg: optional per-run
  `fundAllocations` (funds take their % of the leg), remainder to project shareholders pro-rata
  by `project_members.sharesInvested`; loss leg: same pro-rata, clamped at
  `members.totalContributed` with multi-pass reallocation. Exact integer cents via
  `lib/money.ts` (`splitByPercent`, `splitDividendByShares`, basis points).
- Club dividends: `POST /api/dividends/distribute` + `server/src/modules/finance/dividend-engine.ts`
  — gross earnings → statutory reserve % → net, pro-rata by **club shares**
  (`members.shares`, active members with shares > 0). Preview and payout share
  `planDividendRun` (no drift).

**Member categories:** `members.role`, canonical vocabulary in `lib/member-roles.ts`
(Admin, Manager, Auditor, Investor, Associate Member, Founding Member, Board Member, Member).
Membership category — authorization never reads it.

**Tenant config pattern:** `system_settings` (one row/tenant) jsonb columns
(`meetingTypes`, `penaltyRules`, `paymentMethods`) → `GET/PUT /api/settings` → one shared
TanStack Query entry (`useTenantSettings`) → `useTenant*()` hooks.

**Deposit paths that credit member equity (`members.totalContributed`)** — these are the
enforcement points for the new cap:
- `POST /api/deposits` (direct deposit, [app/api/deposits/route.ts:598](../app/api/deposits/route.ts))
- `POST /api/deposits/[id]/approve` (flex/approval deposit, [approve/route.ts:224](../app/api/deposits/%5Bid%5D/approve/route.ts))
- `POST /api/transactions` (equity-crediting transaction types — verified during implementation)
- `POST /api/transactions/deleted/[id]/restore` (restore re-credits equity)

**Project investment is NOT a deposit** (`lib/project-capital.ts`): it deducts the member's
existing deposit equity and moves cash from a deposit fund into the project fund — so a
project-level member can only ever invest money already deposited within the cap.
Deposit revert / penalty debit equity; penalty waive restores — none need cap logic
(except restore, which re-credits).

**Member creation:** `POST /api/members` + `components/members/create-member-modal.tsx` —
role picked from `MEMBER_ROLES`; club shares assigned at registration.
**Member exit:** `payout-plan` pays free balance = `totalContributed` − committed investments
(suspension workflow) — unaffected by this feature, covered by tests.

## 3. Design

### 3.1 Distribution rules (tenant setting)

- `system_settings.distribution_rules jsonb NOT NULL DEFAULT '[]'` —
  `Array<{ role: string, percent: number }>`, percent ∈ (0, 100], ≤2 decimals,
  unique roles, Σ ≤ 100%.
- **One list for both engines.** The `Project Member` row only ever takes effect in project
  returns (that role never enters the dividend roster — §3.2).
- Shared validation in **new** `lib/distribution-rules.ts` (`parseDistributionRules()` →
  `Map<role, basisPoints>`), consumed by settings API, settings UI, and both run engines.

**Split engine — new pure fn in `lib/money.ts`: `splitByTypeAndShares(totalCents, members: {id; shares; role}[], rulesBp)`**

```
Member pool M
├─ type blocks: B_t = round(M × pct_t)      (largest remainder, deterministic)
│    └─ inside type t: pro-rata by shares among that type's members
└─ remainder R = M − ΣB_t
     → pro-rata by shares among UNCONFIGURED members
     → if no unconfigured members: pro-rata among ALL members
       (conservation: the leg/fund is debited the full amount — no cent un-booked)
```

- **Empty rules ⇒ byte-identical to today's `splitDividendByShares`.**
- 0-share members of any type receive nothing / absorb no loss (existing no-shares behavior).
- Loss reallocation re-runs the same type-aware split over candidates with remaining equity
  (multi-pass stays bounded).

### 3.2 Project-level member (new exclusive category)

- **Vocabulary:** add `Project Member` to `MEMBER_ROLES` (single list — form, endpoints,
  settings picker, i18n all pick it up).
- **Exclusive:** club `shares` forced 0 at creation; the club dividend roster (requires
  `shares > 0`) excludes them automatically, and the dividend planner carries an explicit
  `role !== 'Project Member'` guard (defense in depth). Their share number in a project =
  their `project_members.sharesInvested` in that project.
- **One-project binding:** created bound to exactly one project — the create form shows a
  required project picker + required deposit cap when role = `Project Member`, and the create
  endpoint writes the `project_members` row in the same transaction. Every `project_members`
  write path (create, project shareholder editor, re-capitalise) rejects adding a `Project
  Member` who already has a binding elsewhere (one-project invariant).
- **Deposit cap:** `members.deposit_cap decimal(15,2) NULL` — **required, > 0** when
  role = `Project Member`; nullable/ignored for every other role. Set at creation, raise freely
  later (lowering never removes existing equity).
  - **Cumulative (lifetime) semantics:** the member's total **posted** deposit-credit amounts
    may never exceed the cap. Derived from the ledger (sum of non-deleted deposit-credit rows),
    so no separate counter drifts. A normal withdrawal/refund is a debit and does **not** free
    cap headroom; only a hard revert of a deposit excludes that row (documented edge).
  - Enforced under row locks at every equity-credit path (§2) via a shared helper
    (**new** `lib/deposit-cap.ts` → `assertDepositWithinCap(tx, member, newCents)`), error code
    `DEPOSIT_CAP_EXCEEDED`.
- **Losses:** absorb project losses against their recorded project equity (existing cap
  logic), weighted like any other category.
- **Exit:** payout plan unchanged (free balance only); the cumulative cap is consumed, not
  refunded.

### 3.3 Club dividend with rules

- `computeDividendPlan` / `planDividendRun` accept the rules; member seed gains `role`.
- Chain: gross earnings → statutory reserve (unchanged) → net → **category slices** →
  inside category pro-rata by **club shares**; remainder rule identical to §3.1.
- `POST /api/dividends/distribute` and `/api/dividends/distribute/preview` keep sharing the
  planner; response/audit gain `typeAllocations` + `remainderCents` (same as project returns).
- `dividend-distribution-modal` preview gains the Type column + per-category subtotals.

## 4. Module map (one owner per concern)

| Concern | Owner | Change |
|---|---|---|
| Category vocabulary | `lib/member-roles.ts` | add `Project Member` |
| Rule shape + validation | **new** `lib/distribution-rules.ts` | shared by settings API/UI + both engines |
| Split math | `lib/money.ts` | new `splitByTypeAndShares()` + vitest |
| Cap enforcement | **new** `lib/deposit-cap.ts` | `assertDepositWithinCap()` — cumulative from ledger; one helper, all deposit-credit paths call it |
| One-project invariant | every `project_members` write path (create, shareholder editor, re-capitalise) | reject adding a `Project Member` already bound to another project |
| Tenant config | `system_settings` + Drizzle migration | `distribution_rules jsonb default '[]'` |
| Member model | `members` + Drizzle migration | `deposit_cap decimal(15,2) NULL` |
| Settings API/UI | `app/api/settings/route.ts`, `app/settings/page.tsx` | GET/PUT rules; Financial → "Returns distribution" section (role picker + percent rows, live "configured X%" total, zero pre-selections) |
| Member create/edit | `app/api/members` (+ edit), `create-member-modal.tsx` (+ edit modal) | when role = Project Member: required project picker + required deposit cap; club shares forced 0; create endpoint writes the `project_members` binding in-transaction |
| Deposit credit paths | `/api/deposits`, `/api/deposits/[id]/approve`, `/api/transactions`, restore route | call `assertDepositWithinCap` under existing locks |
| Project returns run | `distribute-returns/route.ts` | consume rules on both legs; type-aware loss reallocation; response/audit `typeAllocations` + `remainderCents` |
| Project read model | `GET /api/projects/[id]`, `types/index.ts` | `involvedMembers.memberRole` (participants select adds `members.role`) |
| Returns modal preview | `components/projects/distribute-returns-modal.tsx` | same engine fn from shared settings cache; Type column + per-category subtotal strip |
| Club dividend run | `dividend-engine.ts`, `/api/dividends/distribute(+preview)`, `dividend-distribution-modal.tsx` | rules into the shared planner; roster guard; preview Type column |
| i18n | `messages/{en,bn,hi,ur}.json` | `roles.projectMember` + settings/cap/project-binding/preview labels — 4-locale parity, `i18n:validate` |

## 5. Phases (each gated: `typecheck` + `lint` + `test` + `i18n:validate`)

1. **Vocabulary + engine + settings** — `Project Member` role value; `lib/distribution-rules.ts`
   + tests; `lib/money.ts::splitByTypeAndShares` + tests (conservation, determinism,
   empty-rules equivalence fuzz, remainder-to-unconfigured, no-unconfigured fallback,
   0-share exclusion, Σ>100% rejection); migration `distribution_rules`; settings API + UI.
   *No distribution behavior changes yet.*
2. **Project Member model + cap** — migration `deposit_cap`; member create/edit API + modals
   (cap required, shares forced 0); `lib/deposit-cap.ts` + enforcement in all four credit
   paths; tests incl. restore-path edge.
3. **Project returns** — route consumes rules (both legs + settle), type-aware loss
   reallocation, `memberRole` in project read model, modal preview mirrors engine.
   Manual run matrix: no rules / partial / 100% / Both with loss cap / settle & close.
4. **Club dividends** — planner takes rules + roster guard, preview/payout parity,
   `dividend-engine.test.ts` + `dividend-single-path.test.ts` extensions, modal preview.

## 6. Decision log (all resolved)

| # | Decision | Chosen |
|---|----------|--------|
| R1-1 | Percent semantics | Category slice; pro-rata by shares inside the category |
| R1-2 | Scope | Every dividend — project returns (both legs) + club dividends |
| R1-3 | Loss leg | Same category weights; equity cap + reallocation kept |
| R2-1 | Project member class | New exclusive role `Project Member`; club shares = 0; never in club dividends |
| R2-2 | Deposit cap | Cumulative lifetime deposits; withdrawals don't free it; admin can raise later |
| R2-3 | Project scope | Exactly one project; bound at creation; a second project is blocked |

No open decisions. Ready for implementation on your go.

## 7. Money & invariant compliance (AGENTS.md §12)

- Integer cents / basis points only; new helpers reuse the largest-remainder discipline.
- Conservation: funds + type blocks + remainder === leg, to the cent (linked fund debit
  stays exactly funded — the #97 class of bug stays closed).
- Loss debits capped at recorded equity; final clamp kept; multi-pass loop bounded.
- Idempotency (`PRJ-RET-…`, dividend reference semantics) and tenant scoping untouched.
- No new transaction types, no ledger-row shape change — audit details get richer only.
- Cap enforced under the same row locks the credit paths already hold (no TOCTOU).
- Soft-delete and share-value-lock rules unaffected.

## 8. Risks / notes

- Rules are read **at run time** (like fund balances); editing rules never rewrites history.
  Freezing rules per project/run is out of scope.
- `Admin`/`Manager`/`Auditor` are valid distribution keys (tenant's choice); optionally the
  settings picker can offer only "economic" roles — one-line filter.
- Lowering a cap below a member's cumulative deposits simply blocks further deposits.
- i18n: role labels exist already (`roles.*`); new keys only for the settings section,
  cap field, and preview labels.
- Preview accuracy: modal previews call the identical engine function; the only server-only
  adjustment remains the loss equity-cap (already disclosed by the existing note).

## 9. v6 add-on — per-project Project Level Member percentage (SHIPPED)

User request: "i want project level member percentage in the member screen,
because each project might be different types of the percentage." Decisions
confirmed in review (same form style as v1): **per project** (one carve-out
for the project's whole PM category, split pro-rata inside), and **blank
falls back to the club rule** (Settings → Financial), with neither set
meaning pure pro-rata — byte-identical to pre-v6 behavior.

Resolution order, owned by ONE place (`lib/distribution-rules.ts`):
`project override → club rule → unconfigured`.

- Storage: `projects.project_member_percent decimal(5,2) NULL` (migration
  0030, additive, both schema trees). NULL = no override. Percent contract
  unchanged: (0, 100] ≤2dp, integer basis points end-to-end (§12);
  `formatPercentBp` (lib/money.ts) is the exact inverse of `parsePercentBp`
  so decimal text never gains a float tail.
- Helpers (rule owner): `parseProjectMemberOverrideBp`, 
  `withProjectMemberOverride` (returns a NEW map — one run's override can
  never leak into another project's preview), `effectiveProjectMemberBp`,
  `assertProjectRulesFit` (Σ of the EFFECTIVE set ≤ 100%).
- Save-time guard (`app/api/projects/_helpers.ts::assertProjectMemberPercentFits`):
  project POST/PUT refuse an override that plus the club categories exceeds
  100%. The run re-checks the effective set at run time, so rules edited
  after a project saved its override can never over-allocate (fail-loud,
  never mis-split). PUT semantics: undefined = untouched, null = cleared.
- Runs: `distribute-returns` builds the effective map once after reading
  settings; profit/loss/both/settle legs, shortfall reallocation and the
  `categoryAllocations` audit all spend the same basis points. Club
  dividends unchanged (PMs are excluded there by design).
- Member screen (the ask): the list service resolves each PM row's
  effective percent server-side (lateral over the ONE bound project —
  project_members stays the source of truth; directory path only) and the
  row renders `Project Level Member · 12.50%`. The detail sheet gains a
  "Category share" tile naming the source (bound project vs club rule vs
  none). The returns preview modal merges the override through the same
  resolver, so its chips match the posted run.
- Project form: optional "Project Level Members share (% of member pool)"
  field with a live club-rule hint; client-side sum check mirrors the server
  via the shared helpers (no re-write). Project header shows the stored
  percent when set.
- Gate: tsc 0, eslint 0 errors, vitest 792/792 (+17 resolver/round-trip
  tests), i18n parity for 12 new keys ×4 locales (bn/hi/ur flagged for
  native review), next build exit 0.
- Migration applied to dev DB; column verified `numeric(5,2) NULL`.

## 10. v7 add-on — member TYPE lock after first transaction (SHIPPED)

User request: "like share number cannot change of a member after a
transaction, I want member type also should be locked to change." Decisions
confirmed in the same review style: **money types only** and **Admin
override with a written reason**.

Why it matters: since the category rules, a member's type decides which
percentage of every member pool is carved. Shares were frozen, but the type
was the last movable money lever — someone could be flipped into the 20%
Board category the day before a big distribution.

- Policy owner: `lib/member-role-lock.ts` (pure). Access titles (Admin,
  Manager, Auditor) stay freely swappable — electing officers is governance,
  not redistribution. ANY change with a money category on EITHER side
  (money↔money, money→access, access→money) is locked once transactions
  exist; unknown/legacy stored values fail CLOSED as money. A null stored
  role normalizes to 'Shareholder Member' (the column default), so null→
  Shareholder is not a change.
- Evidence + race: PUT /api/members/[id] counts transactions with the EXACT
  predicate of the shares lock and applies the patch inside the same
  `FOR UPDATE` member-row transaction — a concurrent first deposit
  serialises against the check, mirroring the shares guard.
- Override: authz Admin only (`normalizeRole`), requires
  `roleOverrideReason` (1–500 chars) which is written into the audit row's
  details next to before/after. Non-admin override attempt →
  `[Field 'roleOverrideReason', Code: OVERRIDE_ADMIN_ONLY]` (403); a locked
  change without override → `[Field 'role', Code: ROLE_LOCKED]` (LockedError,
  the class the shares lock throws). Existing PM conversion guards (cap,
  HAS_CLUB_SHARES, MULTI_PROJECT_BIND) run on top, unchanged.
- Member form mirrors the decision: locked options greyed with a note;
  Admins get the "override + reason" escape hatch. The server decides — the
  UI only prevents obviously-doomed submits.
- No schema/migration change: the lock is behavior, not storage.
- Tests: +8 (full lock matrix). Gate: tsc 0, eslint 0 errors, vitest
  800/800, i18n parity for 6 new keys ×4 locales (bn/hi/ur flagged for
  native review), next build exit 0.

## 11. v8 add-on — human project codes PRJ-XXXX (SHIPPED)

User request: "why there is no project id in the project module". Until now
projects had only an unreadable UUID and a non-unique title — two "Building
A" projects were indistinguishable in lists, pickers, receipts and audit.

- Storage: `projects.project_code varchar(20)` + UNIQUE (tenant_id,
  project_code) (migration 0031, both schema trees). Backfill numbers the
  existing projects per tenant in creation order — applied to the dev DB:
  16/16 numbered, 0 duplicates. The UUID stays the real key; the code is an
  immutable human label (no route accepts it on update).
- Generation: `lib/project-code.ts` — the member-code discipline in one
  place: per-tenant MAX+1 over the strict `^PRJ-[0-9]{4,}$` shape (the
  {4,} keeps counting past PRJ-9999), clash detection limited to OUR
  constraint, and POST /api/projects retrying the WHOLE transaction once on
  a clash — the loser rolls back atomically (fund insert, capital postings,
  member rows), so a concurrent create never double-posts anything.
- Displayed: project list (code line beside the sector, like MEM-XXXX),
  detail header chip, distribute-returns project picker, member-form PM
  bound-project picker, ledger party cell (projectCode added to the finance
  ledger query next to memberCode), and the printable charter's reference
  (was the raw UUID; UUID stays the legacy fallback).
- Search: GET /projects ?search matches project_code too ("prj-3" →
  PRJ-0003). Create audit details carry the code.
- Tests: +3 (format/padding/growth, non-integer refusal, clash-detector
  discrimination). Gate: tsc 0, eslint 0 errors, vitest 813/813 (+3
  skipped by design), i18n unchanged (no new keys — codes are plain text),
  next build exit 0.
- Known follow-up candidates (not in scope): reports/PDF column catalogue
  still prints project title only; a projectCode report column is additive.

## 12. v9 add-on — PM-percent error UX in the project form (SHIPPED)

User request: handle "This project's Project Level Member percentage plus
the configured club categories exceed 100% in total" with proper feedback.

- `parseFieldError` (lib/utils/errors.ts): the ONE client reader of the
  §11 `[Field 'x', Code: Y] sentence` wire format; unmatched text passes
  through untouched so a server error can never be lost to parsing. Tested.
- Project form: a LIVE budget meter under the PM % field computes the
  effective set with the server's own helpers (club categories, PM replaced
  by the typed value or the club PM when blank) and says "Running total:
  X% (max 100%)" while typing; over-100 or malformed input turns the field
  red with the precise sentence and blocks submit. A server refusal on a
  SAVED percent (rules changed in Settings after the form opened — the
  client cache cannot pre-empt that race) is parsed and routed back to the
  same field, and the page's toast stays silent for field-coded errors so
  the message appears once, at the input, not three times.
- No server rules changed — feedback only; the save-time and run-time
  guards remain the enforcement.
- Also repaired en route: a concurrently-added untracked test
  (lib/text-limits.test.ts) imported `@/server/src/...`, which the tsc alias
  cannot resolve (vitest's alias differs); switched to a relative import
  both tools resolve and fixed its four strict-mode optional-index errors.
  Owner of that file: a parallel editing session.
- Tests: +4 (parseFieldError incl. the exact user-visible rejection).
  Gate: tsc 0, eslint 0 errors, vitest 831/836 (5 skipped by design),
  i18n parity for 3 new keys ×4 locales (bn/hi/ur flagged for native
  review), next build exit 0.
