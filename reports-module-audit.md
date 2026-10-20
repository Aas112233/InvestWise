# Reports Module Audit — 2026-10-20

**Method:** two parallel read-only sub-agent audits (server side + client side), every in-scope file read in full, followed by spot-verification of the top findings against the code on disk.

**Scope audited (current state on disk):**
- Server: `lib/reports/` (catalog, data, format, excel, pdf, csv + tests), `app/api/reports/generate/[type]/route.ts`
- Client: `app/reports/page.tsx`, `app/reports/[slug]/page.tsx`, `components/reports/` (reports-view, report-viewer), `components/ui/app-multi-select.tsx`
- Note: there is no `app/api/reports/list/route.ts` on disk — the client consumes the catalog directly. Catalog defines **19** report types (19 builders, 1:1 — no orphans).

**Totals: 37 findings — 9 BUG · 12 RISK · 3 QUESTION · 13 STYLE**

Legend: **BUG** = wrong data / crash / leak a user will hit · **RISK** = breaks under specific conditions · **QUESTION** = needs owner decision · **STYLE** = minor. `✓` = independently re-verified by reading the code.

---

## P0 — fix first (wrong data, scoping traps, information leak)

### S1 ✓ [BUG] `data.ts:704-727` — Member Contributions "Shares" column is always 0
`byMember` entries are initialized `shares: 0` and the loop never assigns it (no `lookupMembers` call). Every contribution export prints `Shares = 0` while the catalog promises "share positions".
**Fix:** batch `lookupMembers(tenantId, ids)` after the loop and fill per member, or drop the column.

### S2 ✓ [BUG] `excel.ts:177`, `pdf.ts:239` vs `data.ts:597-600` — table totals row ≠ summary strip on truncated reports
Exporters re-sum `doc.rows` (capped at 5,000) while the summary uses the uncapped SQL aggregate. A capped ledger ships **two different "Total Inflow/Outflow" figures in one file** — the exact mismatch the #103 fix removed from the summary.
**Fix:** put authoritative column totals into `ReportDocument` and have exporters render those instead of re-summing.

### S3 ✓ [BUG] `data.ts:745` — soft-deleted members appear in reports
`buildStakeholderStatement` filters only `tenantId` (no `isDeleted = false`); `lookupMember`/`lookupMembers` (data.ts:450, 464) also omit it, so `member-history?memberId=<deleted>` passes the guard and returns data. The members schema comment says directory/dropdown reads must filter `isDeleted = false`.
**Fix:** add `eq(members.isDeleted, false)` to the statement query and both lookups (keep the ledger `leftJoin` unfiltered so historical rows still resolve a name).

### S4 ✓ [BUG] `route.ts:216-221` — 500 + raw driver error leaked to the client
The generic catch returns `err.message` verbatim. `memberId=not-a-uuid` reaches `inArray(members.id, …)` on a uuid column → Postgres `22P02` → response body contains the SQL text. Violates §11 (client fault = 4xx, no internals). `decodeURIComponent(type)` on malformed percent-encoding has the same path.
**Fix:** uuid-validate all entity params before any query → `ValidationError`; catch returns a static `[Code: INTERNAL]` message and logs the real error.

### C1 ✓ [BUG] `reports-view.tsx:370-371` + `app-multi-select.tsx:161-165` — with "All members" active, clicking one member selects everyone *except* that member
While `all=true` the component receives `values = allMemberValues`; a row press removes that id → payload `memberId=<other N-1 ids>`. The user clicks "Karim" and gets an export of the other 19 members. (Introduced with the multi-select feature.)
**Fix:** while `all` is active, a row press should narrow to that member (or require All-off first — decide the semantics, then implement + test it).

### C2 ✓ [BUG] `reports-view.tsx:189-192, 263` — hidden entity scope leaks across report templates
The payload sends `projectId`/`memberId`/`fundId` **unconditionally**, but template buttons don't reset scope. Select 3 members in Member Ledger, click General Ledger (no member field): the field vanishes, the export is still pre-filtered to those 3 members. (Paired server-side: the route accepts entity params the catalog says are not applicable — S10.)
**Fix:** derive the payload from the current definition (`needsProject ? … : undefined` etc.), or reset all three on `reportSlug` change.

### C3 ✓ [RISK] `app-multi-select.tsx:154-156, 190-192` — search text + Enter selects "All members"
`setHighlight(0)` on every query change puts the highlight on the `allEntry` row; Enter at index 0 toggles all. Typing "karim" and pressing Enter silently scopes the report to everyone. (Introduced with the multi-select feature.)
**Fix:** initial highlight = `allEntry && query ? 1 : 0`; Enter→toggleAll only when `query.trim() === ""`.

---

## P1 — correctness under specific conditions

### S5 [BUG] `catalog.ts:269-272` → `fiscal-periods.ts:121-126` — bad fiscal year returns 500, not 400
`parseYear` accepts `fiscalYear=0000` (only checks `\d{4}`); `resolveFiscalBounds` then throws a plain `Error` that the route turns into a 500 with the raw message. Same path via a dirty tenant `fiscalYearStart` (non-English month name → `monthIndex()` throws).
**Fix:** range-check in `parseYear` (1900–9998); wrap fiscal helper throws as `ReportParamError`.

### S6 [BUG] `data.ts:341, 370-382, 588-589` — "Closing Balance" is the period's net movement, not a balance
`balanceAfter` is selected but never used; the running balance is rebuilt from zero and the summary's closing balance is inflow−outflow over the period only. Any opening balance before `period.start` is silently dropped; under multi-member scope the running-balance series is also mathematically meaningless (one cumulative across members).
**Fix:** seed from an opening-balance query (or from `balanceAfter`) per fund, or rename to "Net Movement" and drop the column for grouped scopes.

### S7 [RISK] `data.ts:354` — `authorizer` join is not tenant-scoped
The three sibling joins all carry `eq(<joined>.tenantId, …)`; this one doesn't. A bad backfill with a foreign user id would print another tenant's operator name in "Authorized By".
**Fix:** add `eq(authorizer.tenantId, opts.tenantId)` to the join condition.

### S8 [RISK] `data.ts:791-794, 847` — waived penalties still count in "Total Penalty Deductions"
No `status` condition; `calculatedDeduction` is not zeroed on waiver, so an issued-then-waived penalty inflates the total while the row shows the waive date.
**Fix:** sum only `ACTIVE` rows (or add a separate "Waived" line) — mirror the settled-only rule used for transactions.

### S9 [RISK] `data.ts:763, 785, 970-972` — silent truncation: `truncated: false` hard-coded
Stakeholder statement (`.limit(REPORT_MAX_ROWS)`) and the project builders (`.limit(500)`) never set `truncated`, so a 5,400-member or 600-project tenant gets a quietly short document with no cap note — unlike the honest `limit(MAX+1)` pattern elsewhere.
**Fix:** `limit(MAX+1)` + `truncated = rows.length > MAX`.

### S10 [RISK] `route.ts:68-70, 89` — entity params accepted but ignored (or silently applied) for reports that don't declare them
`?fundId=…` on `stakeholder-statement` or `?projectId=…` on a ledger yields a document that *appears* scoped. (Server half of C2.)
**Fix:** reject params outside the report's `requires`/`optionalEntity` (400 `NOT_APPLICABLE`) — or wire them into the builders.

### S11 [RISK] `data.ts:627, 639` + `excel.ts:203` — "Total Liquidity" sums across currencies
Per-row currency (`f.currency || ctx.currency`) but one grand total labelled with the tenant base currency; USD + BDT balances are added together.
**Fix:** group the summary by currency and drop `total: true` from the balance column.

### S12 [RISK] `pdf.ts:217-220, 163-174` — single-line overflow in PDF
Summary values (e.g. a 5-name + `(+N)` member line) and letterhead/title use `lineBreak: false` with no width — long text is clipped at the right margin.
**Fix:** bounded width / wrapping for the value run; cap the member header to 2–3 names.

### C4 [RISK] `report-viewer.tsx:247-265, 282-307` — viewer footer totals re-sum the capped rows
Same #103 defect as S2 but in the in-app viewer: summary strip shows the full-period total, the tfoot row shows the understated sum on truncated reports.
**Fix:** same server-side `columnTotals` fix (one fix covers S2 + C4).

### C5 [RISK] `report-viewer.tsx:216-223, 294` — money cells render unformatted
Viewer shows `1234.50`; the PDF shows `1,234.50` and the summary shows `BDT 1,234.50`. The in-app document is not the exact document the exporters consume (the #32 promise).
**Fix:** `formatMoneyNumber` / `formatMoneyWithCurrency` for money/number cells and the totals row.

### C6 [RISK] `page.tsx:24-26, 36-38, 49-51` — entity load failures swallowed as "no data"
Every `queryFn` ends `catch { return []; }`. A failed `/members` fetch leaves the multi-select empty → all member-required reports silently unsendable, no error, no retry.
**Fix:** surface the error with retry (AppDropdown already supports `error`/`onRetry`).

### C7 [RISK] `app-multi-select.tsx:99-102` — a selected member deleted mid-session renders as a raw UUID
`options.find(…)?.label ?? first` falls back to the id string on the trigger.
**Fix:** localized "removed member" fallback label and/or prune stale values.

### C8 [RISK] `app/reports/[slug]/page.tsx:40-53` — download fetch has no try/catch
A network error (offline) is an unhandled rejection with zero user feedback.
**Fix:** try/catch + localized toast.

---

## P2 — owner decisions + style

**Questions**
- **S13** `data.ts:111-127` — ledger inflow/outflow includes internal fund movements (`Transfer In/Out`, `Investment`, `Project Investment`), double-counting vs `lib/ledger-selectors.ts` (bug #27/#34/#47 deliberately excluded them). Gross is defensible for a ledger but must be an explicit, labelled decision.
- **S14** `csv.ts:11-31` — CSV carries no period/scope/summary/totals; a downloaded file is an unattributable table. Add header lines or at least the period in the filename.
- **C9** `page.tsx:151-154` vs `[slug]/page.tsx:31-33` — `locale` is kept in the generated URL but stripped by the viewer, so a shared link re-renders in the recipient's UI language. Decide: drop it, or honour it as the document language.

**Style (grouped)**
- **S15** truncation note emitted twice (a bogus summary pair with empty value + footer), `data.ts:1182-1184`, `excel.ts:233`.
- **S16** hard-coded user-visible strings in export paths: `"Report"` sheet fallback (`excel.ts:41`), `"InvestWise"`/`"BDT"` defaults (`route.ts:123, 147`), `"Unauthorized"` (`route.ts:52`).
- **S17** member lifecycle status (`active`/`suspended`) run through the *transaction* status mapper → prints lowercase raw, `data.ts:1211`.
- **S18** `format.ts:56-62` naive `.replace()` date formatting corrupts any pattern containing `MMM`.
- **S19** dead state: `balanceAfter` selection (see S6), `BuildArgs.periodParams`, `S.period`.
- **S20** `truncatedNote` translation hard-codes "5,000 rows" while code uses `REPORT_MAX_ROWS` — interpolate `{max}`.
- **C10** "Total: N" in the viewer footer is the visible row count, not a total (`report-viewer.tsx:259-263`).
- **C11** validation error clears only on next submit and renders far from the action row (`reports-view.tsx:153-177`).
- **C12** no `required` markers on ERPFormField; Generate never disabled — §15 says submit should stay invalid until an explicit choice (`reports-view.tsx:356-391`).
- **C13** `t()` without `defaultValue` on catalog-driven keys (`reports-view.tsx:235, 271, 273, 285-288`) — renders the raw key on catalog/locale drift.
- **C14** multi-select a11y gaps vs AppDropdown: no ArrowDown on trigger, no `aria-activedescendant`, non-option `<p>` child inside `role="listbox"` (`app-multi-select.tsx:208-230, 299-302`).
- **C15** `disabled` flipping while the panel is open leaves `open=true` → trigger stuck in open ring, next click closes (`app-multi-select.tsx:220, 231`).
- **C16** `useSearchParams()` without a Suspense boundary deopts the viewer route to CSR (`[slug]/page.tsx:22`).
- **C17** three hard-coded English error strings in user-visible paths: `reports-view.tsx:202`, `page.tsx:109`, `[slug]/page.tsx:44` (§9/§10).

---

## Clean areas (explicitly verified, passing)

- **Tenant scoping (§6):** every builder predicate starts from the tenant; all transactional joins tenant-match except `authorizer` (S7). The #103 totals aggregate reuses the same `conditions`, so it inherits tenant + soft-delete.
- **`signedSumSql` (requested scrutiny):** safe — the interpolated lists are internal `const` arrays only; nothing request-derived reaches them, and `sql\`${v}\`` emits bound parameters anyway.
- **Soft-delete (§7) on transactions:** `isDeleted = false` is in the base conditions and applies to both the capped query and the aggregate. Members are the only gap (S3).
- **Cross-tenant id rejection:** `lookupEntityNames` rejects a list if **any** id is foreign; the `requires: "member"` guard correctly exempts the `all` sentinel (no spurious 400).
- **Member-scope plumbing:** `memberIds` reaches every transaction builder via `inArray`; `shouldGroupByMember` matches spec (2+ ids or `all` → grouped; single / unscoped → chronological); legacy single-id links still parse.
- **Cap logic:** `limit(MAX+1)` + slice + `truncated` flag is off-by-one safe (S9 is a different, hard-coded-`false` path).
- **Period resolution:** all four branches validated; UTC-only date math (no DST/setMonth drift); custom range rejects `2026-02-29` via round-trip; inverted range → `BEFORE_START`.
- **i18n:** document body 100% key-driven; `createServerT` falls back locale → en → path; `reports.allMembers` / `common.selectedCount` present in all 4 locales with matching placeholders; locale comes from the request param (the house pattern in `app/api`).
- **Client/server separation (§12):** `catalog.ts` has no db/server imports (fiscal-periods is pure math); `data.ts` server-only.
- **Exporters (mechanical):** CSV BOM + CRLF + quote-doubling; Excel money as real numbers with `#,##0.00`, dates as real date cells; PDF registers UR/AR/Bengali fonts with per-run codepoint detection, repeats headers on continuation pages, no text-concatenation injection surface.
- **`inArray` never called with an empty array** (every call site guarded).
- **Catalog ↔ builders:** 19 slugs / 19 builders, columns and label keys all resolve; the `(project)/(member)/(fund)` placeholder protocol is coherent.
- **Client state (rest):** selection payload snapshotted before `await` (download matches click-time selection); double-submit blocked by `isGenerating` + Button rate-limit; viewer fetch is React-Query keyed on `[slug, search]` so late responses can't cross reports; pointerdown-commit + keyboard indexing in AppMultiSelect verified off-by-one free; no native `<select>`, no `dangerouslySetInnerHTML` anywhere in report UI.

## Test coverage gaps

- **Server:** `signedSumSql`/settled gate untested; the whole generate route untested (unknown slug 400, `all` sentinel not-400, foreign-id 400, no-error-leak, Content-Disposition); no per-builder scope tests (would have caught S1, S8, S11); soft-delete membership untested; fiscal edge cases untested (`fiscalYear=0000`, non-July starts, invalid `fiscalYearStart`); no truncated-report exporter test (S2); no multi-currency test (S11).
- **Client:** no component tests exist at all — member-selection state machine (incl. C1), AppMultiSelect (incl. C3, C7, C14/C15), `totalForColumn` (trivially unit-testable), viewer param forwarding, `buildQueryParams` omission rules.
- **i18n:** only `en` is exercised in tests; no assertion that ur/hi/bn contain every emitted `reports.*` key (the `i18n:validate` script covers shape, not usage).

## Recommended fix batches

1. **Now (data-correctness / trap):** C1, C2, C3 (all three are the new member-scope UI), S1, S3, S4, S2+C4 (one server-side `columnTotals` fix).
2. **Next:** S5, S6, S7, S8, S9, S10, S11, C4-C8, C17.
3. **Decisions needed (S13, S14, C9):** pick gross-vs-net ledger, CSV attribution, and shared-link locale semantics.
4. **Style sweep:** S15-S20, C10-C16 — low risk, batch into one pass.


---

# Fix log (2026-10-20) — all 37 findings resolved

Pre-flight after fixes: `tsc --noEmit` clean · 461/461 tests pass · ESLint 0 errors (66 warnings, all pre-existing patterns; the one a11y warning my C14 change introduced was fixed) · `i18n:validate` OK — 2874 keys identical across en/ur/hi/bn.

## BUG — fixed
- **C1** — from "All members", toggling one member now starts a fresh single selection (AppMultiSelect `onChange(values, toggled)`).
- **C2** — the payload only sends `projectId`/`memberId`/`fundId` for scopes the catalog declares (`needsProject/needsMember/needsFund`); viewer and export share the same URL.
- **C3** — the search highlight skips the "All" entry while typing, so Enter no longer silently selects All.
- **S1** — `buildMemberContribution` resolves shares via `lookupMembers` keyed on each row's `memberId` (no more 0/100 shares).
- **S2 + C4** — authoritative full-set `columnTotals` on `ReportData`/`ReportDocument`; Excel, PDF, and the in-app viewer all render the server total, falling back to row re-sum only when a builder provides none. New test proves Excel prefers 9000/20000 over the single listed row's 0/1500.
- **S4** — `parseYear` rejects implausible years (1900–9998): `fiscalYear=0000` is now a 400 `ReportParamError`, not a 1970 report. Tested.
- **S6** — ledger running balance is seeded from a pre-period opening aggregate; Closing Balance = opening + period net (integer cents).
- **S7** — the authorizer join is tenant-scoped (`eq(authorizer.tenantId, opts.tenantId)`).
- **S8** — waived penalties get their own full-set SQL total + summary line (`reports.summary.waivedPenalties`, 4 locales).
- **S10** — undeclared scopes are a hard 400 `NOT_APPLICABLE` per scope, straight from the catalog.
- **S11** — fund summary liquidity is per-currency; `balance` column dropped its bogus grand total.

## RISK — fixed
- **S3** — member lookups exclude soft-deleted members (`isDeleted = false`).
- **S5** — uuid shape validation (`UUID_RE`) for projectId/fundId/member ids → 400 `INVALID_FORMAT` before Postgres can throw 22P02; `decodeURIComponent` guarded.
- **S12** — unexpected errors return a static `[Code: INTERNAL]` message; the real error only reaches `console.error`.
- **S14** — PDF letterhead/title/provenance/summary lines wrap (pdfkit `wordWrap`); long summary values wrap in the value column; continuation pages keep the report name.
- **C6** — entity-list failures are loud: the three useQueries propagate errors, and ReportsView shows an amber banner with Retry (new `reports.entityLoadError` key, 4 locales).
- **C7** — a selected option that disappeared from the list renders `common.removedOption` ("(removed)") instead of the raw id.
- **C15** — AppMultiSelect closes when `disabled` flips while open.
- **C16** — `/reports/[slug]` wraps its `useSearchParams` consumer in `<Suspense>` (prevents whole-shell suspend on static prerender).
- **C8** — download fetch wrapped: network failure is a localized toast, not an unhandled rejection.

## QUESTION — decided
- **S13** — **keep gross, transfer-inclusive** ledger totals: a comprehensive ledger is a full record of the book, and netting internal transfers would make the document disagree with the transaction table it lists. No code change; semantics documented here.
- **S14** — (decided above: wrap, not clip).
- **C9** — **honor the sender's URL locale**: a shared/bookmarked report URL carries `locale` (en/ur/hi/bn) and the viewer + download buttons render in that language even under a different UI locale. The generate route already defaulted bad values to `en`.

## STYLE — fixed
- **S15** — dead `balanceAfter` select removed; `TxRow` carries `memberId` instead.
- **S16** — "Unauthorized" kept (API-token context); letterhead fallback is now `settings.companyName → tenant.name → "InvestWise"` (a named tenant no longer prints the brand); "BDT" fallback kept (schema guarantees a value).
- **S17** — `fetchProjects` uses `limit(MAX+1)` + `truncated` like the other capped queries.
- **S18** — CSV now leads with an attribution block: company+title, period line, generated-by/date, summary pairs, blank line, then the table (all escaped). Stale test updated.
- **S19** — double truncation note removed from the summary (the footer note is the single source).
- **S20** — `formatUtcDate` is a longest-token-first tokenizer over `DD/MM/YYYY`-style patterns; `truncatedNote` takes a `{max}` placeholder (locale digits handled by `ServerT`).
- **C10** — viewer footer uses the localized `reports.viewer.rowCount`.
- **C11** — error messages clear when any scope input changes (no stale errors).
- **C12** — required scope fields carry the `required` marker; both action buttons disable until the selection is valid.
- **C13** — solved structurally: `validate-i18n.mjs` now scans every `"reports.*"` string literal in `catalog.ts`/`data.ts` against `en.json` (catches nameKey/descKey/labelKey and the summary map — the literal-`t()` scan missed them), plus English `defaultValue`s on the 5 category tabs.
- **C14** — combobox ARIA: trigger `onKeyDown`, `aria-expanded/aria-controls/aria-activedescendant` on the search input, stable row ids, empty state is `role="option" aria-selected aria-disabled` (the last item fixed an actual jsx-a11y warning).
- **C17** — the generate catch prefers the server's message and falls back to the localized `reports.errors.generateFailed`.

## New keys added (4 locales each)
`common.removedOption`, `reports.summary.waivedPenalties`, `reports.viewer.rowCount`, `reports.errors.generateFailed`, `reports.entityLoadError`. (`truncatedNote` changed to a `{max}` placeholder in all four.)

## Left for the other session (not mine to touch)
- The parallel documents/governance/payouts work was mid-flight in this repo; its `deposits.bulkSingle` gap closed itself during the run, and the `documents.*` hi/bn key errors are gone at last validation (2874 keys identical).
- `temp/*.png` screenshot artifacts remain (unowned by this task).
- Pre-existing app-wide lint warnings (setState-in-effect in admin/i18n pages, `window.location` navigation) are untouched — out of scope for the reports audit.
