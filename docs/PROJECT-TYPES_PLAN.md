# Project Types — Club Level vs Extra Investor (v10 plan)

**Status: phases 1–3 implemented (2026-11-13) — DB, resolver, and the whole API layer. Phases 4–5 (UI, i18n) pending.**
Date: 2026-11-13 · Supersedes nothing; builds on v6 (per-project PM %), v7 (type lock), v8 (project codes), v9 (PM feedback meter).
Implementation log: §11.

---

## 1. The feature

A required `project_type` on every project, chosen at creation:

| | **Club Level** | **Extra Investor** |
|---|---|---|
| Participants | Board Member, Shareholder Member only | Board Member, Shareholder Member, **and** Project Level Member(s) |
| Capital | Shares × share value, ≤ budget (today's model, unchanged) | PM contract takes `% × Total Budget` **first**; Board+Shareholder fund the rest with shares, ceiling = budget − PM capital |
| Distribution | Funds slice → member pool by **club category rules** (Board %, Shareholder %), pro-rata by shares inside each, remainder pro-rata — today's engine, unchanged | Funds slice → **PM carve-out % off the member pool first** → the remaining pool is split **100% purely by share numbers** between Board + Shareholder members together (no category rules) |
| PM % field | Hidden, rejected by server | One field per project (shared by all PMs of that project) |

Everything already shipped stays: funds-take at settle, deposits/equity mechanics, PM one-project-lifetime rule, PM deposit cap, member type lock (v7), project codes (v8), audit trail.

## 2. Decision log

- **D1 — Split-mode choice (user deferred to me):** "As I described" (option a).
  *Why:* it is literally the design the user wrote; it keeps Settings → Financial category rules and the club-dividends module (which already consumes them) intact — option (b) "pro-rata everywhere" would silently break club dividends = exactly the cross-module inconsistency the user fears; option (c) re-introduces the Σ>100 conflict class behind the 150% screenshot bug. Two modes, one resolver (`lib/distribution-rules` remains the single owner used by run, preview, and loss paths).
- **D2 — PM % defines profit AND capital (user choice).** Mechanics in §4.
- **D3 — One shared carve-out per project (user choice).** `projects.project_member_percent` (migration 0030) stays the ONLY percentage field. No per-member column.
- **D4 — Multiple PMs in one project share the carve-out equally** (capital and profit), largest-remainder for residue cents, deterministic tie-break by member code. Needed because PMs no longer hold shares (§4); equal split is the only rule that needs no new input.
- **D5 — `project_type` is immutable once the project has any transaction** (same evidence + `FOR UPDATE` pattern as the shares/type lock). Before any transaction it can be switched freely; switching clears the PM section (dependent-field reset per AGENTS §5).
- **D6 — Backfill:** all projects default `club_level`; any project with a Project Level Member participant OR a stored `project_member_percent` becomes `extra_investor`. For extra-investor projects whose PM % is blank but whose PMs were relying on the club PM rule, the migration seeds the value from the **live club rule at migration time**; if the club rule has no PM %, it stays blank and Save/Settle fail loud demanding it.
- **D7 — The club rule's "Project Level Member" category is retired from the editor** (historical runs keep their stored values for audit reproducibility). Settings copy clarifies: category rules govern Club Level projects and club dividends.
- **D8 — Guards removed, not mutated:** with D1, PM % can no longer conflict with club categories, so the v9 cross-entity machinery (project-save Σ check, settings-save `PROJECT_OVERRIDE_CONFLICT` check, v9 over-100% meter case) becomes dead code for its old purpose. It is **deleted**, and the PM field keeps only the plain 0 < p ≤ 100 shape check + capital preview. Settings keeps its internal Σ≤100 check for its own categories. Removing beats keeping an unreachable rule.

## 3. Data model

**Migration `0032_project_type.sql`** (idempotent, verification DO block, both schema trees):

1. `projects.project_type varchar(20) NOT NULL DEFAULT 'club_level'` + CHECK IN ('club_level','extra_investor') + index for list filter.
2. `project_members.pm_capital decimal(15,2) NULL` — the exact contracted amount a PM row invested (see §4); NULL on all non-PM rows. *(Implemented as `decimal(15,2)`, not the `14,2` drafted here: AGENTS §12 mandates 15,2 for every money column and a 14-digit ceiling buys nothing.)*
3. Backfill per D6.

No new column for PM % — it is `projects.project_member_percent` (0030) re-labeled in the UI as the project's PM contract.

## 4. Money model (integer-safe, AGENTS §12)

Stored truth: integer shares, integer cent amounts, basis-point percentages. Displayed percentages are always **derived**, never multiplied back into money.

**Capital (at invest time, Extra Investor):**
```
pmCapitalTotal = floor(budget_cents × pm_bp ÷ 10000)     -- at most 1¢ residue
clubCapitalCeil = budget_cents − pmCapitalTotal           -- exact by subtraction
per-PM obligation (k PMs) = split pmCapitalTotal equally, largest-remainder
```
- Each PM row posts its obligation as an exact cent amount from its chosen source fund (same ledger legs as a shares purchase; the row records `pm_capital` instead of shares×value). Insufficient member equity or deposit-cap breach → same fail-loud class errors as today.
- Board/Shareholder rows unchanged (shares × share value), but the over-budget check becomes `Σ club capital ≤ clubCapitalCeil`.
- Budget is the anchor; under-subscription never inflates PM obligation (obligation is contractual vs budget and stated as such in the summary).

**Distribution (settle, loss, preview — all via the one resolver):**
```
memberPool = payout − funds slice                     (unchanged)
pmShare    = floor(memberPool_cents × pm_bp ÷ 10000)  → split equally among PMs, largest-remainder
clubPool   = memberPool − pmShare                     (exact by subtraction)
member_i   = clubPool × shares_i ÷ Σshares, floor + largest-remainder residue
ASSERT Σ recipients == memberPool                     else abort, never mis-split
```
Worked example (the current test project, pool BDT 273,069.00, PM 50%, Board 12 sh, Shareholder 50 sh):
PM 136,534.50 · Board ⌊×12/62⌋ = 26,426.03 · Shareholder 110,108.47 (+1 residual ¢) · **sum = 273,069.00 exactly.**

Club Level projects run the existing category-rule engine untouched.

## 5. Validation matrix (all field-coded per §11)

| Where | Rule |
|---|---|
| Project create/edit | `projectType` required; Club Level rejects PM participants and any `projectMemberPercent` (`[Field 'participants', Code: PM_NOT_ALLOWED_IN_CLUB_PROJECT]` / hide field in UI); Extra Investor requires PMs ⇒ PM % present, `0 < p ≤ 100` |
| Shareholder picker | PMs only selectable when type = Extra Investor; PM picker lists only PM-role members with no existing project binding (existing rule) |
| Member form (PM) | "Bound project" picker filters to **extra-investor** projects only |
| Type change (edit) | Only before first transaction (D5); switching Extra→Club with PM rows still present is refused until they're removed |
| Settings save | Internal Σ≤100 kept; `PROJECT_OVERRIDE_CONFLICT` cross-check removed (D8) |
| Settle / loss run | Resolver enforces: extra-investor project with PM rows but no PM % → ValidationError before any posting (fail loud) |

## 6. UI

1. **Project form** — Type selector near the top (create + edit-before-transaction). Extra Investor reveals a compact "Project Level Members" section above the club-shareholders section: PM picker, the one PM % input, and live per-PM obligation amounts (= % × budget). Club Level hides all PM UI.
2. **Live capital math** — "To PMs: X% · BDT …" and "Club capital ceiling: BDT …" chips; the over-budget warning checks against the ceiling.
3. **Pre-save summary (required step)** — a Review panel that appears when Save is pressed with everything valid (and live at the bottom of the form): every participant — name, MEM code, type, shares (or PM %), capital, **effective % of the project**; totals row; conservation line ("allocations add up to 100% / BDT x"). Save confirms from here. Edit reuses the same panel.
4. **Member screen** — v6 field remains the display; source label becomes "this project's contract" (extra-investor) — club-rule source label removed for new saves, kept for history.
5. **Settle/preview modal** — member-pool chip wording per type: Club Level shows category breakdown (today); Extra Investor shows "Project Level Members X% · Board + Shareholder pro-rata by shares". The PM row's Shares column shows `—`, Ownership shows the contract %.
6. **List / detail / charter** — type badge (`projects.types.clubLevel` / `extraInvestor`); detail shows the contract summary line.
7. **Settings → Financial** — copy update per D7 + retire the PM category row from the editor.

## 7. Behavior changes to existing data

- Current projects with PMs (incl. both "test project new" projects) become **Extra Investor**; their next settlement uses the new remainder rule (flat pro-rata), not category rules. Historical postings are untouched.
- Any legacy attempt to put a PM in a club-level project now fails at Save (they'd be classified extra-investor by the backfill, so this only bites new edits that switch type — with the transaction lock, mostly theoretical).

## 8. Test plan

- Engine table-tests: both modes × profit/loss/preview parity; worked example above as a literal case; residue/tie-break determinism; conservation assertion aborts.
- Migration test: backfill classification (PM participant / override / both / neither), club-rule seeding path, idempotent re-run.
- API tests: validation matrix rows, type immutability under concurrent transaction insert (FOR UPDATE), PM picker filter data (extra-investor only) in members/[id] GET.
- Existing v6/v9 tests: PM-override/club-rule merge tests pruned per D8 (kept where they guard history paths).
- Full gate: `tsc --noEmit` · targeted+full `vitest` · `eslint` · `i18n:validate` (non-admin errors 0) · `npm run build`.

## 9. Phases

1. **DB + schema trees + migration 0032** (+dev apply, verification queries).
2. **Resolver split-mode + capital helpers in `lib/distribution-rules`** (+ engine/run/preview/loss wiring, unit tests).
3. **API**: projects POST/PUT type handling, validation matrix, settings cleanup (guard removal), members GET/PUT picker filter, capital posting for PM rows.
4. **UI**: project form (type, PM section, live math, Review-before-save), member form filter, settle modal copy, badges, member-screen label.
5. **i18n ×4** (en contract; bn/hi/ur flagged for native review) · tests · full gate · doc §decisions finalized · diary.

## 10. Risks

- **PM capital posting** touches the shared capital/ledger code on create + edit-refund — the one place with real refactor risk; table-tested against current shares flow before UI work.
- Budget-anchored obligation (D2) means a PM's capital fraction ≠ profit fraction when the club under-subscribes — intentional, shown explicitly in the Review panel.
- `capitalLocked` semantics on PM rows: locked by the same evidence as shares (earnings/expenses exist).

---

## 11. Implementation log

### Phase 1 — DB + schema + migration 0032 (2026-11-13, DONE)

| Artifact | What landed |
|---|---|
| `db/migrations/0032_project_type.sql` | `projects.project_type varchar(20) NOT NULL DEFAULT 'club_level'` + `projects_project_type_check` (vocabulary in the DB, not just the app) + `idx_projects_type (tenant_id, project_type)`; `project_members.pm_capital decimal(15,2)`; evidence-based backfill; club-rule seeding; verification `DO` block that reports club/extra counts and any extra project still missing a contract. |
| `db/schema/projects.ts` **and** `server/src/db/schema/projects.ts` | Same two columns + index, byte-identical trees (verified by hash). |
| Dev DB | Applied. 16 projects → **15 club_level + 1 extra_investor** (`test project new 11.12.2026`, PM 50.00 preserved). 1 PM row, 0 rows with `pm_capital` yet (capital posting is phase 3). 0 extra projects missing a contract. Re-ran the whole file twice by hand: idempotent, same counts. |

Two deliberate deviations from the draft, both recorded above: `pm_capital` is `decimal(15,2)` (§12), and the migration seeds a blank PM % from the club rule only when that rule actually exists — otherwise it stays NULL so the run fails loud rather than inventing a split.

### Phase 2 — Resolver + capital helpers + wiring (2026-11-13, DONE)

| Artifact | What landed |
|---|---|
| `lib/money.ts` | `splitEvenlyCents(total, ids)` — the equal-share primitive a percentage split cannot express (k PMs sharing one contract). Dedupes and id-sorts, residue dealt one cent at a time, sums exactly. |
| `lib/distribution-rules.ts` | `PROJECT_TYPES` / `ProjectType` / `parseProjectType` / `isProjectType`; capital helpers `pmCapitalCents` (floor of budget × bp), `clubCapitalCeilingCents` (subtraction, so pm + club === budget by construction), `splitPmCapitalCents`; **`splitProjectPool`** — the one resolver both modes go through; `assertProjectDistributionContract` — the early, by-name run gate. |
| `app/api/projects/[id]/distribute-returns/route.ts` | Reads `project.projectType`, resolves the split through `splitProjectPool` for the member portion **and** the loss shortfall re-allocation, records the PM contract block in the run's category trace, and names the effective PM percent in `categoryAllocations` for both modes. Category-rule config errors still surface as 400s. |
| `components/projects/distribute-returns-modal.tsx` | Preview calls the same resolver (club rules passed raw; the resolver merges the override), so the table cannot quote a number the ledger will not post. New errors (`PM_PERCENT_REQUIRED`, `NO_CLUB_SHARES`, …) surface instead of silently rendering zero rows. |
| `types/index.ts` | `Project.projectType`, typed from the one vocabulary owner. |

**Behaviour decisions made while wiring** (all documented in code):

- **Club Level is byte-identical**: `splitProjectPool` delegates to `splitByTypeAndShares` with the override merged exactly as before, including the Σ≤100 guard.
- **Extra Investor ignores the club category rules entirely** — verified by test: an 88/12 club rule set produces the same payouts as no rules at all. The remainder is 12:50 shares, never the PM's legacy 20 shares.
- **Loss shortfall re-allocation is by shares for Extra Investor** (no second contract carve): the PMs already took their contract share of the *requested* loss, and a candidate set with no PM cannot pay a fresh carve-out — cents may never go unbooked (§12). Club projects keep the category-weighted re-split they always had.
- **Extra Investor with a 100% contract and no club shares is legal** (nothing left to split); any leftover cents with no share holder throws `NO_CLUB_SHARES` rather than vanishing.
- Determinism/tie-breaks use id order, matching `splitDividendByShares`; member code ordering would need a DB round-trip inside a pure function and gives the same guarantee.

### Verification (phase 1–2 gate)

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `vitest run` | **853 passed**, 5 skipped by design (72 files) — includes 41 resolver tests and 49 money tests |
| Worked example, unit test **and** live DB rows | BDT 273,069.00 at 50% → PM 136,534.50 · Board 26,426.03 · Shareholder 110,108.47, sum exact |
| `eslint` (changed files) | 0 errors; 2 pre-existing warnings in the modal (`fm` dep, setState-in-effect) untouched |
| `next build` | exit 0 |
| Migration idempotency | file re-ran twice by hand: no error, counts unchanged |

### Phase 3 — API: type handling, validation matrix, PM capital posting (2026-11-13, DONE)

| Artifact | What landed |
|---|---|
| `lib/distribution-rules.ts` | `assertProjectTypeRoster` (write-side twin of the run-side contract gate) and `splitPmContractBp` (one contract across k PMs in basis points, for the display column). |
| `lib/utils/validation.ts` | `projectType` on the create schema — **`.optional()`, deliberately not `.default()`**: `projectUpdateSchema` is `partial()` of it, and a default would resurrect the `shareholders` trap already documented in the PUT handler (an omitted key would silently re-type a project on an unrelated edit). `shares` relaxed to `min(0)`: 0 is legal for exactly one kind of row, and the role that decides it is only known where the member rows are locked. |
| `lib/project-capital.ts` | PM rows fund **the derived contract**, never a client amount: `floor(budget × bp)` split equally across the PM rows of the roster, shares forced to 0, `pm_capital` returned per row. The ceiling message distinguishes "over budget" from "the contract left you less". `InvestResult` carries `contractCents` / `clubCapitalCents` for the audit and the summary panel. |
| `POST /api/projects` | Persists `projectType`, passes type + contract to the capital engine, writes `project_members.pm_capital`, and the `Project Investment` ledger text reads "BDT … by Project Level Member contract" instead of "N shares @ value". |
| `PUT /api/projects/[id]` | D5 type lock — a type change is refused once the project has ANY non-deleted transaction (`[Field 'projectType', Code: PROJECT_TYPE_LOCKED]`, `LockedError`). The roster gate runs on both paths: inside the capital engine when capital changes, directly (participants' roles joined in) when it does not. |
| `GET /api/projects` | `?projectType=` filter for the member-form picker. An unknown value is a 400, never a silently dropped filter — a dropped filter would offer club projects to a Project Member binding. |
| `POST /api/members` | Binding a Project Level Member to a Club Level project is refused: `[Field 'projectId', Code: CLUB_PROJECT_TAKES_NO_PM]`. The picker filter is convenience; this is the rule. |
| `app/api/projects/_helpers.ts` | **`assertProjectMemberPercentFits` deleted (D8)**, with a comment recording why an unreachable check is worse than none. |
| `app/api/settings/route.ts` | **The `PROJECT_OVERRIDE_CONFLICT` cross-entity scan deleted (D8)** — Settings keeps its internal Σ≤100 over its own categories. |

**New field-coded error codes (§11)**: `PM_NOT_ALLOWED_IN_CLUB_PROJECT`, `PERCENT_NOT_ALLOWED_IN_CLUB_PROJECT`, `PM_PERCENT_REQUIRED`, `PM_HOLDS_NO_SHARES`, `INVALID_SHARES`, `PROJECT_TYPE_LOCKED`, `CLUB_PROJECT_TAKES_NO_PM`, `INVALID_PROJECT_TYPE`.

**Behaviour change to know about**: saving the existing Extra Investor test project through the CURRENT project form is refused with `PM_HOLDS_NO_SHARES` (its PM row still holds 20 shares). Deliberate — silently re-funding a PM from 20 shares (BDT 20,000) to the 50% contract (BDT 250,000) is exactly the money movement that must never happen behind a user's back. Phase 4's form sends PM rows at 0 shares with the contract derived, which makes the save go through.

### Verification (phase 3 gate)

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `vitest run` | **862 passed**, 12 skipped by design (73 files) — +9 unit cases (roster matrix, contract-bp split) and a new 7-case integration suite |
| `__tests__/project-type-capital.integration.test.ts` | Drives the REAL `investProjectCapital` against real Postgres inside a transaction that always rolls back: contract 250,000.00 on a 500,000 budget at 50%; two PMs at 125,000.00 / 25.00% each; project fund +312,000 while the two deposit funds lose exactly 262,000 + 50,000; each member's equity down by exactly their own leg; all five refusal codes. Zero residue confirmed (tenants 5, projects 16, members 160, `PT %` rows 0). |
| `eslint` | 0 errors, 0 warnings on every changed file |
| `next build` | exit 0 |

### Still open (phases 4–5)

Project form (type selector, PM section, live contract chips, **Review-before-save panel**), member-form project filter, type badges, settle-modal wording, Settings copy + retiring the PM row from the rules editor (D7), member-screen label; then i18n ×4 and the final gate.

### Phase 4 — UI (2026-11-13, IN PROGRESS, paused mid-gate)

Shipped so far (all markers verified present in the working tree):

| Artifact | What landed |
|---|---|
| `components/projects/project-form-modal.tsx` | Project-type section with two cards (unset on create — no pre-picked money decision, AGENTS §15; pre-selected from the stored value on edit); `typeLocked` mirrors the D5 ledger lock so the cards disable rather than fail on save; the retired v9 Σ meter replaced by the contract field + two derived chips (contract amount / per-PM obligation, and what the club may still fund); a **Project Level Members section** (source fund → member, PM-role only, no shares box — their capital is the derived contract); **Review-before-save panel** — participant table with category, weight and capital, the two pots side by side, and a Confirm that posts the exact reviewed payload; `handleTypeChange` clears the PM roster on Extra → Club (§5 dependent reset). |
| `components/projects/distribute-returns-modal.tsx` | PM rows show `—` instead of a misleading "0 shares", and the ownership column is derived per type: `contract ÷ k` for a PM, `shares ÷ club shares × (1 − contract)` for Board/Shareholder. Amounts still come only from `splitProjectPool`. |
| `components/projects/project-list-view.tsx` | `Extra Investor` badge beside the title (club is not badged — it is what every other column already assumes). |
| `components/projects/project-detail-view.tsx` | Type named in full in the header; the PM line reads "contract: X% of budget" on an Extra Investor project; PM capital rows show `—` for shares with a hover explanation. |
| `components/members/member-form-modal.tsx` | Bound-project picker requests `/projects?projectType=extra_investor` + a hint naming the reason. |
| `app/settings/page.tsx` | 'Project Level Member' removed from the rules-editor role list while an already-saved PM row keeps rendering its percent (D7); section copy states these rules govern Club Level projects and club dividends, and that Extra Investor projects ignore them. |

**Why the gate is paused**: another process is editing this same working tree at the same time (see §12). The tree currently fails `tsc` in files unrelated to project types, so no green/red signal here is trustworthy until one writer is in control.

### 12. Interruption record — concurrent writer (2026-11-13 ~01:05–01:12 AST)

While Phase 4 was being written, these files changed under the session without being part of it: `lib/categories.ts`, `lib/categories-db.ts`, `lib/use-tenant-settings.ts`, `server/src/db/schema/system_settings.ts`, `app/api/expenses/route.ts`, `components/expenses/expense-modal.tsx`, `components/expenses/expenses-view.tsx`, `lib/member-payouts.ts`, `app/api/auth/login/route.ts`, `app/api/auth/refresh/route.ts`, `lib/rate-limit.ts`, plus repeated writes to `app/settings/page.tsx` and `components/projects/project-detail-view.tsx` while this session was editing them. The current `tsc` failure is `systemSettings.expenseCategories` / `.projectCategories` not existing on the schema — a tenant-categories feature in mid-flight, nothing to do with project types.

Consequences recorded honestly: (1) no Phase 4 gate result may be quoted as passing or failing until the tree has a single writer; (2) `temp/_ins.mjs` — deleted by this session's scratch cleanup wildcard — was almost certainly the other writer's file, which is why it was absent from git and from the recycle-bin scan.
