# Superadmin Panel — InvestWise vs Pathshala-Pro

**Scope:** InvestWise `app/admin/**` + `app/api/admin/**` + `lib/superadmin-service.ts` vs Pathshala-Pro `src/app/system-admin/**` + `src/app/api/system-admin/**` + `src/components/system-admin/**`
**Date:** 25-10-2026 · Both are Next.js multi-tenant SaaS control planes; InvestWise's panel is a deliberate port of Pathshala's (see the "Pathshala-Pro System Admin styling" comments in `components/admin/admin-shell.tsx` and "Pathshala-Pro superadmin-service port" in `lib/superadmin-service.ts`).

Legend: ✅ full · 🟡 partial · ❌ missing

## 1. Screen-by-screen versus

| Screen | InvestWise | Pathshala-Pro | Verdict |
|---|---|---|---|
| Overview | Tenants, MRR (real plan prices), ARR, active subs, trials, conversion, needs-attention list | Tenants, MRR (`active × 249` — inflated for free tier), live infra status + DB latency probe, recent tenants, quick-access cards, inline Onboard button | IW money math is better; PS has live health probe + quick shortcuts |
| Tenants directory | Search, suspend, maintenance, force-delete (simple confirm), full onboarding sheet (financial config + extra funds) | Directory + Edit-configuration modal, 3-step force-delete wizard with impact counts | 🟡 |
| Tenant 360° detail | Financial throughput (deposits/withdrawals/dividends/expenses/net reserves), users w/ per-user support session, module licensing, maintenance, suspend | Subscription lifecycle panel, session-policy panel, edit config, login-as-admin, module access, 3-step danger-zone delete | 🟡 |
| Users | Cross-tenant directory, search + role/status filters, edit role/status/name, **password reset + sign-out-all**, **guarded account delete**, impersonate | Edit role/status only (`GET, PATCH`) | IW stronger |
| Billing | MRR/ARR/conversion/attention cards, plan catalogue CRUD, status+plan change with reason & confirm summary, history modal | Billing table, plan list, **Excel export**, end-date endpoint, manual run-expiry, PATCH | Split |
| Notices / Broadcasts | Inline composer: title, message, active, auto-expire, retract | Modal composer: **priority, audience (all / specific tenants multi-select), pinned**, expiry, published toggle, edit | 🟡 |
| Feature flags / Modules | Module catalogue with categories, required flags, per-tenant overrides, diff-only save, search, "API rejects disabled modules" | Flat per-tenant toggles + defaults | IW stronger |
| Audit logs | Two tabs: Platform Actions (`super_admin_action_log`) + Tenant Audit, server pagination + action filter | Single mutation stream + high-risk (DELETE/CREATE) summary tiles, client-side filters | IW stronger overall; PS has risk tiles |
| Settings | Platform name, support email/phone, default trial days, default currency/timezone, public registration toggle, global maintenance + message, diff-only PATCH | Settings page present | Comparable |
| Diagnostics | Platform health: DB latency/engine, uptime, memory, JWT/isolation posture | Per-tenant business-data integrity inspector (`lib/admin-diagnostics`: placement/fee checks, findings per record) | Different tools — IW lacks the data-integrity inspector |
| **Templates** | ❌ none | ✅ full Onboarding-Templates CRUD: built-in + custom, class/section/group/subject editor, duplicate, reset built-in, active toggle, version counter; consumed by the onboard modal to auto-seed structure | ❌ Missing |
| Impersonation | Dedicated **Support Sessions** page (searchable target list, active-session state) + per-user start | Tenant-level "Login As School Admin" only | IW stronger |

## 2. Backend API surface versus

| Capability | InvestWise route(s) | Pathshala-Pro route(s) | Gap in IW? |
|---|---|---|---|
| Tenant CRUD + onboard | `admin/tenants` (GET,POST), `admin/tenants/[id]` (GET,PATCH: status/maintenance/name/plan/maxUsers; DELETE force), `admin/tenants/onboard` | `tenants`, `tenants/[id]` (PUT full config; DELETE `mode=hard` with confirmTenantId/confirmName/reason) | API parity for edit fields — **no UI to use it** |
| Subscriptions | `admin/billing` (GET,POST status/plan), `admin/billing/history`, `admin/plans` (full CRUD) | `system-admin/billing` (GET,POST,PATCH), `subscriptions/[tenantId]` (view+history+plans, POST plan/end-date/grace-days), `subscriptions/end-date`, `subscriptions/plans`, `subscriptions/run-expiry`, `tenants/subscription-status` | 🟡 end-date/grace editing exists in service (`changeTenantSubscription` accepts `currentPeriodEnd`, `trialEndsAt`, `graceEndsAt`) but no endpoint/UI exposes them |
| Health | `admin/diagnostics` (health), global `health` | `system-admin/health` (DB probe) + `system-admin/diagnostics` (data-integrity inspector) | 🟡 no per-tenant data-integrity tool |
| Users | `admin/users` (GET,PATCH,POST reset-password,DELETE) | `system-admin/users` (GET,PATCH) | IW stronger |
| Templates | ❌ | `system-admin/onboarding-templates` (+ `[id]`, `+ [id]/reset`) | ❌ |
| Backup/restore | `backup`, `backup/list`, `backup/restore`, `cron/backup` | ❌ | IW-only advantage |
| Cron | `cron/subscription-expiry`, `cron/governance-sweep` | `subscriptions/run-expiry` (manual trigger) | 🟡 IW cannot trigger the sweep from the panel |

## 3. What InvestWise's superadmin panel is MISSING (ranked)

1. **Onboarding / seed Templates system** — PS can define reusable setup presets (built-in + custom, editable, duplicate, reset, versioned) and the onboard flow lets the operator pick one to auto-seed the tenant's structure. IW onboarding always provisions the same standard fund set with no way to save/reuse an org configuration template.
2. **Per-tenant subscription lifecycle UI** — edit paid-through end date, trial deadline, grace days; see days-remaining, grace window, isBlocked, and a per-tenant change-history timeline *inside* the tenant page. IW's service layer already supports every field (`changeTenantSubscription` in `lib/superadmin-service.ts:102-119`) — the UI just never sends dates ("the admin UI changes status without dates (it has no date inputs)", `superadmin-service.ts:50`). A `subscriptions/[tenantId]`-style endpoint + panel is the missing piece.
3. **Tenant "Edit Configuration" modal** — after onboarding, IW's UI only toggles status/maintenance. The PATCH API already accepts `name`, `plan`, `maxUsers` (`app/api/admin/tenants/[id]/route.ts:205-245`) but no form exposes them; currency/timezone/date-format/fiscal-year are not editable from the panel at all (they're only set at creation).
4. **High-friction force-delete wizard** — PS shows live impact counts (users/students/vouchers/transactions), requires typing the tenant ID, then the exact name, then a ≥8-char reason, blocks protected tenants, and sends the confirmations to the server. IW's force delete is one generic confirm dialog (`app/admin/tenants/page.tsx:294-306,777-807`).
5. **Targeted broadcasts** — PS supports priority levels, audience = all tenants or a selected multi-tenant list, and pinned banners. IW broadcasts hit every tenant with no targeting, priority, or pinning.
6. **Per-tenant session policy** — PS has a concurrent-vs-single-session switch per tenant (`tenant-session-policy-panel.tsx`). No equivalent in IW's panel.
7. **Data-integrity diagnostics** — PS's Admin Tools page runs read-only consistency checks against one tenant's live data (e.g. fee/placement mismatches) and lists findings per record. IW's Diagnostics is health-only.
8. **Billing export** — PS exports the billing table to Excel. IW has none (note: `app/api/reports/export-generic` exists app-side but is not wired into the admin panel).
9. **Manual expiry-sweep trigger** — PS's `subscriptions/run-expiry` lets an operator run the sweep on demand. IW's `cron/subscription-expiry` is cron-only; no button.
10. **Live health probe on Overview + quick-access cards** — PS dashboard shows Operational/Degraded/Unreachable with DB round-trip before you click anything; IW's sidebar shows a hardcoded "Platform Healthy" dot + `v0.1.0` (`components/admin/admin-shell.tsx:200-208`).

## 4. Where InvestWise is already AHEAD (keep these)

- **Users page:** password reset that signs the user out of every device, guarded account deletion with ledger-preserving detach + 3 anti-lockout guards (`deleteUserAccount`, `lib/superadmin-service.ts:443-596`), impersonation, server-side search/filter/pagination.
- **Support Sessions page** with audit attribution and 30-min dual-token sessions (`issueImpersonationSession`).
- **Billing:** real-plan MRR/ARR (no ×249 inflation), trial-conversion rate, full plan catalogue CRUD with retire-vs-delete rules, reason-carrying status changes with confirm summary, per-tenant history timeline modal.
- **Module licensing** with typed definitions, categories, required flags, diff-only saves, and API-level enforcement.
- **Audit:** separate Platform Actions stream (target/IP/admin attribution) alongside tenant audit.
- **Onboarding:** financial configuration + extra funds, password-strength meter, slug auto-derivation mirroring provisioning rules.
- **Backup/restore + cron backup** APIs — Pathshala has none.
- Money handling discipline: integer-cents math and server-side decimal strings, vs Pathshala's `active * 249` estimate and float sums.

## 5. Suggested build order for the gaps

| # | Item | Effort | Why first |
|---|---|---|---|
| 1 | Subscription control panel on tenant detail (end date, grace days, days remaining, timeline) | Small — service layer already exists | Revenue ops is the control plane's core job |
| 2 | Tenant Edit Configuration modal (name, plan, maxUsers — API ready; then settings fields) | Small | API + audit already built, UI is the only missing layer |
| 3 | Force-delete wizard with impact counts + typed confirmations | Medium — needs an impact-count field in `admin/tenants/[id]` GET | Correctness/safety of an irreversible op |
| 4 | Broadcast targeting (audience + priority + pinned) | Medium | Communication precision |
| 5 | Run-expiry-now button + health probe on Overview | Trivial | Quick wins reusing existing endpoints |
| 6 | Session policy per tenant | Medium — needs enforcement in auth/session layer | Security posture |
| 7 | Onboarding templates (seed presets) | Large | Highest-value but most product-shaped feature; design around funds/projects/settings first |
| 8 | Per-tenant data-integrity inspector | Large | Worth it once tenants have real data volume |
