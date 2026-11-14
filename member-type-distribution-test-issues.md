# Test Issues — Member-Type Distribution feature build

Log of defects observed while building `docs/MEMBER-TYPE-DISTRIBUTION_PLAN.md`.
Pre-existing issues are flagged as such — not introduced by this feature.

---

## ISSUE-001 — 45 i18n errors (admin-screen `t()` keys missing from en.json) (PRE-EXISTING)

- **Severity:** Low (cosmetic — screens render their English `defaultValue`, so nothing looks broken; the i18n gate stays red)
- **Module:** i18n / `app/admin/billing/page.tsx`, `app/admin/tenants/[id]/page.tsx`, `components/admin/subscription-control-panel.tsx`
- **Found:** 2026-11-12 during Phase 1 gate (`npm run i18n:validate`)
- **Repro:**
  1. `npm run i18n:validate`
  2. Observe ~44 errors like `t("admin.billing.sweepDone") in app/admin/billing/page.tsx has no entry in en.json`
- **Baseline proof:** `git show HEAD:messages/en.json` contains none of `sweepTitle`, `wipeButton`, `userLastLogin` — the gap predates the member-type-distribution work.
- **Expected:** Every literal `t("key")` in the UI has an entry in en.json (the validator's own rule), plus 4-locale parity. Then `i18n:validate` exits 0.
- **Notes:** This is exactly the drift the validator header warns about ("silently render its English defaultValue … which is how the whole meetings module shipped English-only"). Fix = add the keys to all 4 locales; bn/hi/ur values need a native review.

---

## (no feature defects yet — Phase 1–4 findings will be appended below)
