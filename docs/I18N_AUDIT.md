# i18n Audit — All Modules

**Scope:** `app/`, `components/`, `lib/` (217 files) · `messages/{en,ur,hi,bn}.json` (1,419 keys each)
**Method:** `node scripts/audit-i18n.mjs` (added by this audit) + manual verification of every dynamic key
**Date:** 2026-09-30

---

## Verdict

| Check | Result |
|---|---|
| Key parity across 4 locales (`npm run i18n:validate`) | ✅ **PASS** — 1,419 keys identical, all placeholders match |
| Translation coverage of *actual UI* | ❌ **FAIL** — 389 call sites untranslated |
| Dictionary efficiency | ❌ **FAIL** — 745 keys (52.5%) dead |
| Placeholder / interpolation integrity | ✅ **PASS** — 0 mismatches |
| Dynamic key safety | ⚠️ 11 keys resolve, 1 is fragile |

**The parity validator passes and the app is still broken.** Those are not the same question, and the repo was only checking the easy one.

---

## What is actually healthy

- **Structural integrity is perfect.** All 4 locale files have identical key trees, identical value types, and matching `{placeholder}` sets. Whatever tooling produced them was careful.
- **No raw key paths reach the UI.** All 389 broken references carry a `defaultValue`, so `t()` always has copy to fall back on.
- **Interpolation is sound.** 0 placeholder mismatches across ~1,000 live call sites.

---

## Findings

### P1 — 389 untranslated call sites (332 unique keys, 31 files)

These reference keys that exist in **no** locale file. Because each has a `defaultValue`, the page renders correct English — but in **ur / hi / bn the same screen stays English**. Users switching to any non-English language see a partially translated app with no error and no missing-text marker.

| Module | Broken keys | Status |
|---|---:|---|
| `admin` | 74 | namespace exists, new sub-namespaces missing |
| `projects` | 56 | namespace exists, largely disjoint naming |
| `goals` | 33 | namespace exists, largely disjoint naming |
| `transactions` | 23 | 19 dict keys, 18 orphaned — effectively 100% mismatch |
| `common` | 16 | shared keys missing from a populated namespace |
| `finance` | 6 | **namespace absent from all 4 locales** |
| `governance` | 62 | **namespace absent from all 4 locales** |
| `meetings` | 56 | **namespace absent from all 4 locales** |
| `reports`, `auth`, `ui`, `members`, `funds` | 6 | scattered |

**124 keys point at namespaces that do not exist in any locale file at all** — `governance`, `meetings`, `finance`. Three complete modules ship with zero translation coverage.

### P2 — 745 orphan keys (52.5% of the dictionary)

Defined in all 4 locales, translated into 4 languages, and referenced by nothing. Worst hit: `projects` (101 of 116), `common` (68), `dashboard` (63), `members` (61), `reports` (57), `deposits` (55), `dividends` (52).

These are fully translated dead weight — shipped to every client on bundle load, and a standing maintenance trap because translators keep being paid to maintain strings no user will see.

### P3 — 4 sites render server `message` directly

`res.message ?? t(...)` — when the server supplies a message it **wins**, so the toast is always English:

- `app/forgot-password/page.tsx:34`
- `app/register/page.tsx:117`
- `components/deposits/deposit-modal.tsx:125`
- `components/deposits/deposit-request-view.tsx:100`

### P4 — 11 dynamic keys (verified safe, 1 fragile)

All 11 `t(\`...${var}\`)` call sites were traced by hand and **do** resolve:

- `common.months.${key}` → `MONTH_KEYS = ["jan"…"dec"]` ✅ exactly matches dict
- `common.weekdays.${key}` → `WEEKDAY_KEYS = ["mon"…"sun"]` ✅ exact match
- `members.statusLabels.${status}` → `active, pending, inactive, suspended` ✅

One is a real hazard: `app/settings/page.tsx:207` derives its key from a **payload property name** —
`t(\`settings.tabs.${Object.keys(variables)[0] ?? "organization"}\`)`. It works only because the form happens to submit exactly the four keys `organization|financial|governance|system`. If a form section is ever renamed, this silently renders `settings.tabs.<raw-key>` in the UI with no build-time error.

---

## Root cause

The dictionary and the components use **two different naming conventions**, and the codebase sits mid-migration between them.

- **Dictionary convention** (older, grouped): `common.save`, `goals.title`, `admin.impersonate.start`, `deposits.recordedToast`
- **Component convention** (newer, verbose): `common.saveChanges`, `goals.newGoal`, `goals.updatedSuccess`, `admin.users.title`

The newer components were written against a namespace that was **never backfilled into `messages/*.json`**. The `defaultValue` pattern is what made this invisible: it made every broken ref look intentional and harmless, so both the parity validator and visual review stayed green while the ur/hi/bn experience silently collapsed.

Note that this is *not* a translation-quality problem. The existing 1,419 keys are correctly translated into all four languages. The defect is purely one of **wiring**.

---

## Remediation

1. **Backfill the missing namespaces first** — `governance` (62), `meetings` (56), `finance` (6). These are whole modules with no coverage; nothing else can be verified until they exist.
2. **Add the 208 in-namespace keys** to `messages/en.json`, then run the `extract-i18n.mjs` / `phase*-i18n.mjs` pipeline to propagate to ur/hi/bn.
3. **Fix the 4 server-message leaks** — invert to `t(...) ?? res.message`, or return a stable `code` and map it to a key client-side.
4. **Re-point `app/settings/page.tsx:207`** at an explicit section→key map instead of deriving it from a payload property.
5. **Prune the 745 orphans** once the backfill lands — they should be genuinely unreferenced, so this is a safe delete.
6. **Wire `audit-i18n.mjs` into CI** (or `npm run typecheck`) so the next mid-migration state cannot pass silently again.

> Step 6 is the important one. `i18n:validate` proves the four files agree with each other; it cannot prove the files agree with the code. Both checks are needed.

---

## Re-running

```bash
node scripts/audit-i18n.mjs              # full report, exit 1 on defects
node scripts/audit-i18n.mjs --json       # write docs/i18n-audit.json
node scripts/audit-i18n.mjs --hardcoded  # also scan for unwrapped UI text
npm run i18n:validate                    # existing 4-locale parity check
```
