# Audit 06 — Printable Financial Documents (Receipts, Vouchers, Charters, Report Exports)

**Scope:** `components/documents/**`, `app/print/[kind]/[id]/page.tsx`, `lib/documents.ts`,
`app/api/transactions/[id]/route.ts`, `app/api/projects/[id]/route.ts`, `lib/reports/**`,
`app/api/reports/**`, `db/schema/{transactions,projects,member_payouts,member_arrears}.ts`.
**Method:** static read of the document templates, their data-fetching routes, and the schema
columns available to them. Read-only — no source file was modified.
**Lens:** documentary-evidence sufficiency for a pooled-funds / cooperative investment society that
moves real deposits, dividends, and exit settlements. Not a rendering or CSS review.

---

## Bottom line

The print surface is **architecturally sound and visually disciplined** — one A4 frame, mm-exact
layout, RTL-safe, void stamping, tenant-scoped fetches, localized status labels. That is not the
problem. The problem is **informational sufficiency**: the paper is systematically *less* informative
than the screen that produced it, and it omits exactly the fields that make a document usable as
**evidence** — the period the money belongs to, the counterparty leg, the balance effect, the identity
of the person who cancelled it, and when/why the sheet itself was issued.

Concrete proof of the thesis: the deposits desk renders a **Month** column
(`components/deposits/deposits-list-view.tsx:437-440`) and an in-app receipt panel that prints
`deposits.columns.month` (`:672`) — but the *official printed receipt* has no month at all, because
`GET /api/transactions/[id]` never selects `depositMonth`
(`app/api/transactions/[id]/route.ts:30-56`) and `DepositReceiptData` has no field for it
(`components/documents/deposit-receipt.tsx:9-25`). The translation key
`reports.columns.depositMonth` already exists in all four locales, so this is a wiring gap, not a
localization gap. The document a member keeps is weaker than the screenshot a member could take.

| Severity | Count |
|---|---|
| Critical (C) | 4 |
| High (H) | 7 |
| Medium (M) | 8 |
| Low (L) | 4 |
| **Total** | **23** |

Plus **9 document types with real monetary or legal consequence that have no printable form at all**
(§4) — this is the largest single gap in the audit, not any individual missing field.

---

## 1. Inventory — what can actually be printed today

### 1.1 Per-transaction / per-entity sheets (browser print, A4 HTML)

`lib/documents.ts:2` defines exactly four kinds: `"deposit" | "project" | "project-update" | "voucher"`.

| Kind | Template | Data source | Trigger |
|---|---|---|---|
| `deposit` | `components/documents/deposit-receipt.tsx` | `GET /api/transactions/[id]` | after deposit create (`deposit-modal.tsx:280`), on approve (`deposits-list-view.tsx:349`), row action (`:114`) |
| `voucher` | `components/documents/ledger-voucher.tsx` | same | transactions list (`app/transactions/page.tsx:102`) |
| `project-update` | `components/documents/project-update-receipt.tsx` | same | after posting earning/expense (`app/projects/page.tsx:296`), updates list (`:462`) |
| `project` | `components/documents/project-charter.tsx` | `GET /api/projects/[id]` | after project create (`app/projects/page.tsx:253`), project list (`project-list-view.tsx:248`) |

All four render through `components/documents/document-frame.tsx` (letterhead: org name, tagline, doc
type, reference, one date; body rows; signature block; centred footer).

### 1.2 Report exports (server-rendered, 19 report types)

`lib/reports/catalog.ts` × `lib/reports/data.ts` → `pdf.ts` (pdfkit, script-aware fonts, RTL for Urdu),
`excel.ts` (exceljs), `csv.ts`, `json` for the in-app viewer. These are **materially better documents
than the per-row sheets**: they carry a period line, generated-at / generated-by provenance, per-page
footers with page x/y, a confidentiality note, and a totals row. §2 findings apply unevenly: the
report family is audited only where it shares a defect.

---

## 2. Critical findings — the paper cannot serve as evidence

### [C-01] The deposit receipt omits the deposit month — the period the money is legally FOR — Severity: Critical

**Evidence:** `db/schema/transactions.ts:38-42` defines `depositMonth` ("the month a deposit is FOR,
selected explicitly in the deposit form — can differ from the collected date on back-entry"). It is a
first-class business key, not a label:
- one-deposit-per-member-per-month is an enforced rule, and the duplicate error message is keyed on it
  (`lib/deposit-month-limit.ts:228-236`);
- arrears are computed per `period_key` (`db/schema/member_arrears.ts:10`);
- ledger and member-history reports already expose the column (`lib/reports/data.ts:189, 363, 613, 728`);
- the deposits screen already shows it (`deposits-list-view.tsx:437-440, 672`).

**Not printed:** the API select (`app/api/transactions/[id]/route.ts:30-56`) has no `depositMonth`, so
`deposit-receipt.tsx:71-89` cannot show it. The sheet shows only the **value date** (`data.date`).

**Why it matters:** for a monthly-assessment society, the month *is* the obligation being discharged.
Two receipts for the same member, same fund, same amount, different months are byte-identical on paper.
On back-entry (collected 5th, entered 7th, credited to the previous month — the exact case the schema
comment describes), the printed date points at the wrong period, so the receipt **cannot rebut an
arrears claim** and cannot be matched to a `member_arrears` row. A finance committee reconciling
"deposits received in September" against receipts will get the wrong answer, silently.

**Fix:** add `depositMonth` **and** `submittedDate` to the GET select; render
`Deposit for: <localized YYYY-MM>` with the same `depositMonth || monthKeyOf(date)` fallback the screen
uses, plus a separate `Collected on` / `Recorded on` pair. No new i18n keys are required.

---

### [C-02] Documents carry no issuance timestamp, no copy designation, and no issuance log — Severity: Critical

**Evidence:** `document-frame.tsx:77-89` letterhead prints `dateLabel` only, and the footer (`:137-139`)
repeats *the same* `dateLabel`. So the sheet contains **zero** information about when the document was
generated. `GET /api/transactions/[id]` writes no audit entry, and `app/print/[kind]/[id]/page.tsx`
logs nothing — there is no record that a receipt was ever issued, reissued, or by whom. There is no
"Original / Duplicate / Copy" designation anywhere in `components/documents/**`.

**Why it matters:** this defeats the two controls a receipt exists to provide.
1. **Non-repudiation:** a receipt printed today for a transaction recorded three years ago is
   visually indistinguishable from one printed the day of payment. Nothing on the paper dates its own
   creation.
2. **Duplicate-claim:** a member can open `/print/deposit/<id>` repeatedly and hand over N identical
   "originals". For an exit settlement or dividend payout, that is a double-claim vector with no paper
   trace. By contrast the report PDFs do stamp generated-at/by and page numbers (`lib/reports/pdf.ts`)
   — the weaker family is the one used for individual money receipts.

**Fix:** print `Issued: <datetime + timezone>` and an `Original` / `Reprint #n` badge in the letterhead;
`logAudit({ action: 'PRINT_DOCUMENT', ... })` from a server call (or make the sheet a server component
so issuance is inherently logged), and add a print counter column on the transaction row.

---

### [C-03] No amount-in-words and no authenticity mark on any amount — Severity: Critical

**Evidence:** `DocAmount` (`document-frame.tsx:149-162`) renders one numeric `formatMoney` value and
nothing else. No words figure exists anywhere in `components/documents/**`, `lib/documents.ts`, or
`lib/reports/**` (verified: zero matches for amount-in-words helpers).

**Why it matters:** every bank, NGO, and cooperative voucher standard in the BDT/South-Asian
investment-society context requires the words line, precisely because it is the cheapest tamper
evidence available: altering `1,50,000` to `15,00,000` on a printed or edited copy is undetectable
without it, and the numeric-only sheet gives a dispute nothing to check against. There is also no
verification code, QR, or hash on the document, so a printed receipt cannot be checked against the
ledger by anyone holding the paper — closing C-02 and C-03 together with one control.

**Fix:** add `DocAmountWords` rendering the amount in the tenant locale (en/ur/hi/bn), plus a short
`Verification code` derived from `id + referenceNumber` and a `/verify/<code>` lookup that returns the
row's *current* authoritative state.

---

### [C-04] A PENDING or REJECTED deposit prints as a clean, official receipt — Severity: Critical

**Evidence:** `deposit-receipt.tsx:38-43` maps status to a text row; only *voided* rows get the
`DocVoidStamp` (`:60-65`). Nothing visually distinguishes an unapproved receipt from a settled one at a
glance, at arm's length, or in a photocopy. Worse, the **first** sheet a member typically receives is
printed straight after creation (`deposit-modal.tsx:254-280`), i.e. while the row is still `PENDING`.
Row-level print access is also unconditional: the Print action is `show: true`
(`deposits-list-view.tsx:114`) while every authoring neighbour is gated (`canEdit / canVerify /
canRevert / canDelete`, `:255-267`), and the feeding GET checks only `getAuthContext` + tenant scope,
no screen permission (`app/api/transactions/[id]/route.ts:19-25`) — so within a tenant, a plain Member
can fetch and print another Member's receipt by id. (Note: the cross-**tenant** IDOR recorded for this
route in `docs/audit/01-security-auth.md` SEV-011 is now closed — the query is tenant-scoped. The
intra-tenant gap is what remains.)

**Why it matters:** a receipt is a representation to a third party that money was received and
accepted. Issuing one for a pending, unverified deposit — and issuing it to whoever can guess or obtain
an id — makes the app a source of false financial documents.

**Fix:** (a) a bordered diagonal banner `SUBJECT TO VERIFICATION — NOT RECEIPT OF FUNDS` for
non-`Completed` rows, mirroring the void-stamp treatment; (b) gate print behind an explicit
print/verify screen permission, and refuse cross-member prints for Member-level roles.

---

## 3. High & Medium findings

### [H-05] Fund-transfer voucher prints one leg with no link to its twin
The API already resolves the sibling leg **including its `referenceNumber`**
(`app/api/transactions/[id]/route.ts:74-90`), but `ledger-voucher.tsx:69-77, 116` renders only the
counterpart *fund name*. `transferGroupId` (schema `:18-21`) is selected but never printed. The
delete path deliberately voids both legs together (`route.ts:270-326`) — the paper does not. So the two
halves of one transfer cannot be tied together on paper, and one leg printed twice reads as two
transfers. **Fix:** print counterpart reference + transfer group id + "leg 1 of 2 / leg 2 of 2".

### [H-06] Project-Investment legs never name the fund the money left
`transactions.sourceFundId` (`db/schema/transactions.ts:32-35`) exists precisely because without it
"the project fund is credited while the deposit fund keeps the same cash, and the treasury
double-counts it" (migration 0015). It is neither selected in the print GET nor rendered by any of the
four templates. Every one-sided investment document therefore shows a credit with no debit — the single
most common way printed evidence fails a treasury reconciliation. **Fix:** resolve and print
`Source fund` for Project Investment / Investment rows on both the voucher and the charter's capital line.

### [H-07] No double-entry presentation and no opening balance
`transactions.balanceBefore` (schema `:44`) is unused by any document; `balanceAfter` appears only on
the voucher and only when non-null (`ledger-voucher.tsx:123-125`). A document called "Financial Voucher"
with a single amount and no Dr/Cr side cannot be footed, and §12's `SUM(debits) === SUM(credits)`
invariant is unverifiable from paper. **Fix:** for transfer/settlement vouchers, render a two-line
journal block (account, Dr, Cr) plus `Opening balance → Movement → Closing balance`.

### [H-08] Deposit receipt states cash but not the member's resulting entitlement
The receipt prints the amount only. It never states the member's **contribution balance** after the
deposit (`members.total_contributed`), which is the exact value the payout engine reserves against and
the arrears engine measures (`member_payouts.ts:14-17`: payouts are the FREE BALANCE, "never
shares × share value, because `members.shares` is a fixed onboarding allocation"). A member who receives
a cash-only receipt reasonably infers ownership proportional to that cash; the system's actual rule is
contribution-balance based. That mismatch is a dispute waiting to be documented. **Fix:** print
`Contribution balance after this deposit` and an explicit footnote that share allocation is governed by
the society's register, not this receipt. Do **not** print "shares credited" — this system does not
credit shares on deposit.

### [H-09] Project Charter identifies the project by UUID and has no signatory
`project-charter.tsx:55-58` leaves both signature blocks name-less, and `:61` passes `reference={data.id}`
— a 36-char UUID — because `db/schema/projects.ts` has no human-readable project code. A charter is the
founding document of a pooled-capital venture; as printed it cannot be cited, indexed, or matched to a
bank instruction. Missing as well: project owner/sponsor, capital source (see H-06), expected ROI /
target return, disbursement schedule, and `projects.isLocked` (schema `:25`, one-way after a
settle-and-close run) — so a charter printed after settlement is identical to one printed at inception,
which is exactly the moment a stakeholder needs the difference visible.
**Fix:** add a `PRJ-####` per-tenant code, print `Status` *and* `Locked / Settled on <date>`, print
prepared-by and approved-by names from `createdBy`/`authorizedBy`, and add the sponsor + capital-source
rows.

### [H-10] Cancelled documents never name who cancelled them
`transactions.deletedBy` and `createdBy`/`updatedBy` (schema `:46-50`) are never resolved to names. The
void stamp shows only the void *date* (`document-frame.tsx:186-205`), and
`project-update-receipt.tsx:10-26` has no `deletionReason` field at all — so the project-update sheet
voids a posting without stating the reason the voucher does show (`ledger-voucher.tsx:129-131`).
A cancelled instrument that does not name the canceller is not an audit trail.
**Fix:** join `deletedBy → users.name` into the print GET, add `Voided by` to the stamp, and give the
project-update receipt the same deletion-reason block the voucher has.

### [H-11] Document identity of the issuing entity is a bare name + tagline
`document-frame.tsx:66-89` prints organisation name and tagline only — no registered office, no contact,
no company/cooperative registration or licence number, no tax number, no branch/cashier station. For a
document that evidences receipt of public pooled money, the issuer's legal identity and the *place*
where the money was taken are both material. **Fix:** extend the letterhead from `system_settings` /
`tenants` (registration no., address, phone) and add a `Branch / Point of receipt` row.

### [H-12] No fiscal-period status on any transaction document
The ledger enforces period openness on every write (`assertFiscalPeriodOpen`,
`app/api/transactions/[id]/route.ts:152, 298`) and `db/schema/fiscal_periods.ts` models it, but no
printed sheet states which fiscal period the entry is filed under, or whether that period is closed.
Reports do carry a period line (`lib/reports/data.ts` `buildReportDocument`); the receipts do not.
**Fix:** print `Fiscal period: <FY / month> — <OPEN|CLOSED>`; a receipt issued into a closed period is a
restatement and should say so.

### [M-13] Untranslated raw DB values on paper — *partly retracted, see §8*
`depositMethod` is printed as stored (`deposit-receipt.tsx:76`, `ledger-voucher.tsx:122`, and the panel
at `deposits-list-view.tsx:671`) — no label helper exists for payment methods anywhere (`lib` has zero
`paymentMethodLabel`-style exports), so a Bengali-language receipt shows `BKASH`. Project `category` is
likewise raw (`project-charter.tsx:65`) while `status` is mapped (`:43-53`). This breaks §9's localized-
value rule for the document family. **Fix:** a shared label map for tenant payment methods and project
categories, used by both screen and sheet.

### [M-14] Multi-page printing has no continuation chrome
`document-frame.tsx` fixes the sheet to `minHeight: 297mm` with a `flex: 1` body (`:92-93`); the only
break control is `breakInside: avoid` per row (`:34`). A charter with many participants, or a long
remarks block, flows onto page 2 with: no repeated letterhead, no page numbering, no "continued"
marker, and the signature block pushed to a page whose header identifies nothing. The report renderer
solved all of this (`lib/reports/pdf.ts` repeats headers and stamps page x/y) — the HTML family did not.
**Fix:** `@page` margin boxes or a `thead` repeat + a "Page n of m / ref" running footer in `PRINT_CSS`
(`app/print/[kind]/[id]/page.tsx:22-31`), and keep signatures with the last body block.

### [M-15] The brand accent and hairlines are background paint
`PRINT_CSS` (`page.tsx:22-31`) sets `@page { margin: 0 }` and hides chrome, but the letterhead dot uses
`background: var(--primary)` (`document-frame.tsx:73`) and the rules are `border`s on a white sheet.
With the browser dialog's "Background graphics" unchecked — the default in several enterprise Chrome
policies — the accent disappears, and `margin: 0` risks content clipping at the physical edge on
printers with a non-printable border. The void stamp already anticipates this ("a bordered stamp
survives a printer set to no colour", `document-frame.tsx:182-185`); the letterhead should follow the
same rule. **Fix:** use `@page { margin: 10mm }`, and prefer `border`/`currentColor` over `background`
paint for every mark that carries meaning.

### [M-16] `submittedDate` never reaches any document
The schema distinguishes collected date from the date the row was entered (`db/schema/transactions.ts:52-55`)
specifically to make back-entry visible; `GET /api/transactions/[id]` doesn't select it, so a receipt
printed for a deposit entered late looks like it was recorded on the day of collection. Paired with
C-01, the paper cannot distinguish *when money moved*, *what period it belongs to*, and *when it was
written down*. **Fix:** print all three dates under explicit labels.

### [M-17] `expenseName` is dropped from the expense voucher
The dedicated expense label (schema `:15-17`) exists so an expense has a name beyond its category, and
the expense-audit report column set uses it (`lib/reports/data.ts` expense-audit adds `expenseName`) —
but the printed voucher falls back to category + narration (`ledger-voucher.tsx:118-121`), so paper
says "Rent" where the record says "Rent — second tranche, Dhanmondi office". **Fix:** select and print
`Expense name`.

### [M-18] Report exports: no recipient, no purpose, no sign-off block
`lib/reports/{pdf,excel,csv}` stamp generated-at/by and a confidentiality note, but no `Prepared for`,
no `Purpose / distribution list`, and no authorisation sign-off line — so a management report printed
for a member and one printed for an auditor are the same artefact. For SOC-2 / regulator use, a
management-report PDF normally needs both. **Fix:** optional recipient + purpose inputs on
`components/reports/reports-view.tsx`, echoed into the PDF/Excel provenance block, plus a signature row.

### [M-19] Ad-hoc CSV bypasses the document standard entirely
`app/api/reports/export-generic/route.ts` converts any client-supplied row array to BOM CSV with no
letterhead, period, provenance, or currency handling — it is audit-logged (`EXPORT_GENERIC_DATA`) but
produces an unattributable spreadsheet that nonetheless circulates as a financial record. **Fix:** stamp
attribution into the CSV header like `lib/reports/csv.ts` does, or restrict the endpoint to data the
catalogued reports already cover.

### [L-20] Void stamping is inconsistent across the family
`deposit-receipt`, `ledger-voucher`, `project-update-receipt` stamp voids; `project-charter` has no
void/cancel path at all, although projects are soft-deletable. **Fix:** charter support for cancelled
projects.

### [L-21] Reference falls back to the UUID silently
`data.referenceNumber || data.id` (`deposit-receipt.tsx:57`, `ledger-voucher.tsx:90`) prints a UUID
wherever a reference is null, with no indication that the document has no official reference.
**Fix:** print `No reference assigned` and treat a null `referenceNumber` on a settled money row as a
data-integrity flag.

### [L-22] No pagination/serial integrity across a print run
Nothing on the sheet asserts it is 1 of N (bulk deposits, dividend runs). Related to C-02.

### [L-23] Print fidelity depends on the browser dialog
There is no server-rendered PDF of a receipt, so a "document" is whatever the operator's print dialog
produced (paper size, margins, scale, background graphics). For a legally retained instrument, the
canonical artefact should be the server PDF the report family already knows how to make.
**Fix:** add a pdfkit renderer for the four kinds (reuse `lib/reports/pdf.ts`) as the archival copy.

---

## 4. Documents that do not exist — the largest gap

Each item below is a money- or governance-bearing object already modelled in the schema, with real
obligations and already-enforced invariants, that has **no printable form**. Members, officers, and
auditors cannot obtain paper for any of them.

| # | Missing document | Data already in the system | Why it is financially required |
|---|---|---|---|
| 1 | **Member passbook / annual statement of account** | `transactions` by member, `member_arrears`, `profit_allocations`, `member_payout_*`, `members.total_contributed` | The member's single source of truth for what they own. The report family has `member-ledger`/`member-history`, but those are management analytics, not a signed member statement addressed to one person for one period. |
| 2 | **Dividend / profit distribution warrant + run certificate** | `profit_allocations`, distribute-returns payout rows and their `PRJ-RET-…` idempotency references (§12) | The legal acknowledgement of a distribution to a shareholder, and the per-run certificate proving the run's total matched the fund debit. Neither exists on paper. |
| 3 | **Exit settlement agreement + per-installment paid receipt** | `member_payout_plans` / installments: `totalAmount`, `paidAmount`, `installmentCount`, `intervalMonths`, `firstDueDate`, `sourceFundId`, `reason`, cancel fields | The reservation semantics (free balance, not shares × value; project money arrives as a top-up only after settle; officer presses Pay) live entirely in code comments (`member_payouts.ts:14-27`). Without a signed plan, the parties hold irreconcilable versions of the same promise. |
| 4 | **Arrears demand notice + waiver certificate** | `member_arrears` (`period_key`, `requiredAmount`, `actualDeposited`, `shortfall`, `waivedBy`, `waivedReason`) | A demand and a waiver are both documents with consequences; today both exist only as table rows. |
| 5 | **Equity / contribution transfer deed** | transfer legs + the two explicit acknowledgements in `server/src/modules/finance/service.ts:1896-1915` (gift-without-contribution, amount-without-shares) | The system forces the officer to acknowledge, on screen, that one party is giving away a claim on future surplus — and then issues no document to either party recording that. This is the clearest evidentiary failure in the audit. |
| 6 | **Fund transfer advice note (dual-leg, one page)** | both legs via `transferGroupId`, `balanceBefore/After`, custodian + account number on `funds` | Fund-to-fund movements between custodians need one paper covering both sides; today they need two half-vouchers (H-05). |
| 7 | **Project settlement / completion certificate** | settle-and-close run: remaining balance computed server-side, `status='Completed'`, `completionDate`, one-way `is_locked` (§12) | The moment capital is finally allocated between profit and loss legs is the moment a shareholder most needs paper — and the only artefact is a generic Project Update receipt. |
| 8 | **Fiscal period close certificate** | `fiscal_periods`, `assertFiscalPeriodOpen` | Auditors ask "prove November was closed at these totals, by this person, at this time". Currently unanswerable. |
| 9 | **Governance meeting minutes + attendance sheet + penalty notice** | `meetings`, `meeting_attendees`, `member_penalties` (tier, deduction, reason, `waivedAt`) | Penalties are money deductions decided in a meeting. A deduction with no minutes and no notice is an unenforceable charge. |

---

## 5. Field sufficiency matrix (per-transaction sheet)

Columns available on `db/schema/transactions.ts` vs. what reaches paper through
`app/api/transactions/[id]/route.ts:30-56`.

| Column | Deposits list screen | Reports | **Printed sheet** | Verdict |
|---|---|---|---|---|
| `referenceNumber` | yes | yes | yes | ok |
| `date` (collected) | yes | yes | yes | ok |
| `depositMonth` | **yes** (`:440, :672`) | **yes** | **no** | **C-01** |
| `submittedDate` | no | no | **no** | **M-16** |
| `amount` | yes | yes | yes | ok |
| `balanceBefore` | no | partial | **no** | **H-07** |
| `balanceAfter` | no | yes | voucher only | **H-07** |
| `sourceFundId` | no | no | **no** | **H-06** |
| `transferGroupId` | no | no | **no** (selected, unused) | **H-05** |
| `expenseName` | no | **yes** | **no** | **M-17** |
| `depositMethod` | yes | yes | yes, raw | **M-13** |
| `category` | yes | yes | yes, localized | ok |
| `handlingOfficer` | yes | yes | yes | ok |
| `authorizedBy` → name | yes | yes | yes | ok |
| `createdBy` / `updatedBy` | no | no | **no** | **H-10** |
| `deletedAt` | yes | yes | yes | ok |
| `deletedBy` → name | no | no | **no** | **H-10** |
| `deletionReason` | yes | no | voucher only | **H-10** |
| fiscal period status | no | period line | **no** | **H-12** |
| amount in words | no | no | **no** | **C-03** |
| issuance timestamp / copy no. | — | yes (PDF) | **no** | **C-02** |

---

## 6. Remediation order

1. **C-01 deposit month + C-16 submitted date** — one field added to one select and one `DocRow`;
   zero new i18n keys; closes the user-reported defect. Highest value per line changed.
2. **C-04 approval banner + print permission gate** — stops the app issuing false documents.
3. **C-02 issuance stamp/log + C-03 words line and verification code** — one server-rendered PDF path
   (reuse `lib/reports/pdf.ts`) delivers all four at once, and gives the society an archival canonical
   artefact instead of browser output (also closes L-23).
4. **H-05 / H-06 / H-07 / H-10** — counterpart reference, source fund, Dr/Cr + opening balance,
   canceller name. These are the reconciliation fields; do them as one voucher-restructuring pass.
5. **H-08 / H-09 / H-11 / H-12** — entitlement line, project code + signatories + lock status, entity
   registration letterhead, fiscal-period line.
6. **§4 items 2, 3, 5, 7** — payout warrant, settlement agreement, transfer deed, completion
   certificate: the four documents whose absence is most likely to turn a routine dispute into an
   unprovable one.
7. **M-13 → M-19, L-20 → L-22** — consistency, pagination, letterhead paint, report attribution,
   generic-CSV stamping.

## 7. Acceptance criteria for this audit

For each of the four existing kinds, a printed sheet must answer, without reference to the screen:
*who* paid or received, *how much* in figures **and words**, *for which period*, *when the money moved*,
*when the record was written*, *when this document was issued and as which copy*, *which fund/account
was debited and which credited*, *the balance after*, *who authorised*, *who cancelled and why*, and
*whether the entry is settled, pending, rejected, void, or in a closed fiscal period* — with every value
localized in all four locales, and with the sheet reproducible server-side as an identical PDF.

Any new document type added from §4 must meet the same list before it is considered shipped.

---

## 8. Remediation status (2026-10-23)

Implemented against the existing four sheets plus the shared frame. Verified with
`npx tsc --noEmit`, `npx eslint` on the changed files, `npx vitest run` (48 files / 508 tests green,
including the new `lib/amount-in-words.test.ts`), and `npm run i18n:validate` (2914 keys in parity
across en/ur/hi/bn).

| Finding | Status | What shipped |
|---|---|---|
| C-01 deposit month | **fixed** | `depositMonth` + `submittedDate` selected in the print GET; `Deposit for <Month Year>` and `Collected on` rows on the receipt, `Deposit for` on the voucher; same `depositMonth || monthKeyOf(date)` fallback the screen uses |
| C-02 issuance stamp / log | **fixed except the reprint counter** | letterhead and footer now carry `Issued: <datetime>` plus a stable 7-char sheet code derived from the reference; `?purpose=print` writes a `PRINT_DOCUMENT` audit entry from both document APIs |
| C-03 amount in words | **fixed (English, lakh/crore)** | `lib/amount-in-words.ts` + `DocAmount words=`, on the receipt, voucher, project update and charter capital |
| C-04 pending prints | **fixed (banner + API gate)** | `DocBanner` on non-settled rows for all three money sheets; the print GET now requires `TRANSACTIONS`/`DEPOSITS` read **or** an own-row match via `members.userId`/`email` — previously it had no authorisation floor |
| H-05 transfer legs | **fixed** | paired voucher reference printed with the counterpart fund |
| H-06 source fund | **fixed** | `sourceFundId` joined to `sourceFundName` (separate `funds` alias); `Capital drawn from` on the voucher and as a charter participants column |
| H-07 balance trail | **partial** | `balanceBefore` + `balanceAfter` now both print; a true Dr/Cr journal block is still open |
| H-08 member entitlement | **fixed** | `Member contribution balance` row plus a footnote stating share allocation is governed by the register, not the receipt |
| H-09 charter signatories / lock | **partial** | `projectFundHandler` now fills Prepared By; `is_locked` prints as a LOCKED banner + record-state row; a human-readable `PRJ-####` project code still needs a migration |
| H-10 canceller identity | **fixed** | `deletedBy → users.name` in the void stamp, on all three money sheets; `deletionReason` added to the project-update receipt |
| H-11 issuer identity | **fixed** | letterhead renders `companyAddress`, `companyRegNo`, `companyPhone`/`companyEmail` — all already present in `system_settings` |
| H-12 fiscal period | **fixed** | period row `2026 · OPEN/CLOSED`, resolved from `fiscal_periods` for the value date |
| M-13 raw values | **retracted for methods, fixed for category** | see note below |
| M-14 multi-page | **fixed where browser print allows** | `@page` now has real margins (the 210mm sheet no longer overflows the printable area), `thead` repeats, and a fixed running strip re-prints org · doc type · reference on every page. Absolute page numbers are **not** achievable in Chromium print — they belong to the server-PDF path (L-23) |
| M-15 background paint | **fixed** | the letterhead mark is an outlined circle rather than a `background` dot, so it survives "Background graphics" off |
| M-16 `submittedDate` | **fixed** | printed as `Booked on`, only when it differs from the recorded date |
| M-17 `expenseName` | **fixed** | `Expense` row via the existing `reports.columns.expenseName` key |
| L-21 UUID fallback | **fixed** | `reference={data.referenceNumber}` only; the frame prints "No reference assigned" instead of a UUID |
| M-18, M-19, L-20, L-22, L-23, all of §4 | **open** | report-recipient fields, generic-CSV attribution, charter void path, print-run serialisation, server-rendered archival PDFs, and the nine missing document types |

**Correction to M-13 (self-retraction).** I wrote that `depositMethod` was "stored English printed
untranslated". That is wrong: payment methods are tenant-configured free text by design
(`lib/payment-methods.ts:19-22` — `name` is "Free-text label the organisation sets"), so printing
`bKash` verbatim is correct behaviour, not a defect. Only the project `category` half was real, and it
now goes through `getCategoryLabel` on the charter.

**Verification caveat.** The working tree already carried another writer's uncommitted
tenant-timezone work when this fix started (`lib/tenant-time.ts`, `db/migrations/0022_tenant_timezone.sql`,
320 changed lines in `server/src/modules/finance/service.ts`). That work currently fails
`tsc` at `server/src/modules/finance/service.ts:825` (`Date | null` passed to `new Date`). It is not
part of this fix and was left untouched; no type error is reported in any file changed here.
