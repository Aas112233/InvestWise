# InvestWise — Project Memory (curated)

## Environment

- **Database:** Supabase Postgres, transaction pooler (`:6543`), region
  `ap-northeast-1` (Tokyo). Dev machine is GMT+3 → ~200-300ms round-trip floor
  per query. **This is the #1 app-slowness factor.** For local dev, prefer a
  local Postgres or a closer region.
- Two DB access layers coexist (migration in progress):
  - `db/index.ts` — used by `app/api/**` route handlers (`getDb()`).
  - `server/src/lib/db.ts` — used by `server/src/**` modules.
  Both use `postgres-js` with `prepare: false` (required for the pooler).

## Architecture conventions

- Next.js 15 App Router; all 21 `page.tsx` are currently `"use client"` and 18
  API routes are `force-dynamic` — i.e. effectively a SPA on Next.js. No SSR
  data. Server Components migration is the largest outstanding perf win.
- Auth: JWT access (15m) in HttpOnly cookie `accessToken`; `lib/middleware/auth.ts`
  (`getAuthContext`) has an in-process identity cache keyed by sha256(token),
  30s TTL. `server/src/lib/session.ts` has a separate 60s user cache.
- **Tenant isolation (§6) is enforced in: `listMembers`, `listFunds`,
  `app/api/deposits` GET (all fixed 2026-09-27).** `requireTenant` fails closed
  (throws 403) rather than degrading to an unscoped query.

## Gotchas

- `getPaginationParams(query, { maxLimit })` — default ceiling is **100**. Any
  endpoint feeding a dropdown must pass `maxLimit` matching its Zod cap, or
  rows silently truncate.
- Zod `limit` caps and `maxLimit` must stay in sync (members: 500, funds: 200).
- `messages/ur.json` invalid-JSON issue (line 923) was fixed externally
  (verified 2026-09-27): all 4 locales parse and `tsc --noEmit` is fully clean.
- Tenant settings: always import from `lib/use-tenant-settings.ts`
  (single `["settings"]` query). Do NOT re-declare inline `/settings` fetchers.

## Tooling

- `DB_LOG_TIMING=1` → logs per-query wall-clock ms (`db/index.ts` `onquery`).
  Use this to measure round-trip latency before/after any region change.
- Tests: `npx vitest run` (51 passing). Typecheck: `npx tsc --noEmit`.
- `npx next lint` is deprecated in Next 15 (migrate to ESLint CLI for Next 16).
