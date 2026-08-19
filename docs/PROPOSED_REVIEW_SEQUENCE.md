proceed

4:38 AM





 Module 8 Deep Code Audit \& Performance Review

Target Module: Goals, AI Advisory \& System Settings

 Included Files in this Review:

Backend Core:



server/src/modules/goals/service.ts

server/src/modules/goals/routes.ts

server/src/modules/ai/service.ts

server/src/modules/ai/routes.ts

server/src/modules/settings/service.ts

server/src/modules/settings/routes.ts

server/src/db/schema/goals.ts

server/src/db/schema/system\_settings.ts

Frontend \& Client State:



client/components/Goals.tsx

client/components/Settings.tsx

client/components/AiAssistant.tsx

 Line-by-Line Audit Findings

1\.  Performance \& Caching Invalidation

[CRITICAL] Issue 1.1: Cache Bypass via Pre-Cache DB Query in getSettings()

Location: 

server/src/modules/settings/service.ts#L20-L38

Severity: HIGH

Problem: Look at lines 20–25:

ts





export async function getSettings(): Promise<Record<string, unknown>> {

&#x20; // Auto-lock share value if transactions exist (enforced on every read before caching)

&#x20; await checkAndAutoLockShareValue();

&#x20; return cache.getOrSet(SETTINGS\_CACHE\_KEY, async () => { ... }, SETTINGS\_CACHE\_TTL);

}

checkAndAutoLockShareValue() runs before checking the in-memory cache. Inside checkAndAutoLockShareValue(), it executes a SELECT FROM system\_settings and a SELECT COUNT(\*) FROM transactions. Because this runs on every invocation of getSettings(), the in-memory 5-minute cache is effectively bypassed, forcing 2 database roundtrips on every authenticated page load!

Recommended Fix: Move checkAndAutoLockShareValue() inside the cache.getOrSet factory so it only evaluates when cache is cold or explicitly invalidated:

diff





&#x20;export async function getSettings(): Promise<Record<string, unknown>> {

\-  // Auto-lock share value if transactions exist (enforced on every read before caching)

\-  await checkAndAutoLockShareValue();

\-

&#x20;  return cache.getOrSet(

&#x20;    SETTINGS\_CACHE\_KEY,

&#x20;    async () => {

\+      await checkAndAutoLockShareValue();

&#x20;      const db = getDb();

&#x20;      const \[settings] = await db.select().from(systemSettings).limit(1);

2\.  Security \& API Rate Limiting

[CRITICAL] Issue 2.1: Missing Rate Limiter on LLM AI Assistant Gateway

Location: 

server/src/modules/ai/routes.ts#L11

Severity: HIGH

Problem: POST /api/ai/query forwards chat completions to upstream LLM providers (OpenAI / LongCat). Currently, the endpoint does not have rate-limiting middleware attached. A runaway client loop or malicious actor could issue hundreds of concurrent prompts, exhausting server API quotas and incurring financial charges.

Recommended Fix: Apply a dedicated aiLimiter (e.g. 10 requests per minute per IP/user) in routes.ts.

[WARNING] Issue 2.2: Missing Upstream Abort Timeout in AI Client

Location: 

server/src/modules/ai/service.ts#L32-L44

Severity: MEDIUM

Problem: fetch(apiUrl, ...) does not configure an AbortSignal.timeout(30\_000). If the remote AI model experiences upstream latency or hangs, the Node HTTP handler remains open indefinitely.

Recommended Fix: Pass signal: AbortSignal.timeout(25\_000) to the fetch call.

3\.  Clean Code \& Config Integrity

[WARNING] Issue 3.1: Frontend Environment Variable in Backend Process

Location: 

server/src/modules/ai/service.ts#L19

Severity: LOW

Problem: process.env.VITE\_LONGCAT\_API\_KEY is checked in Node.js server code. VITE\_ prefix is for client bundle exposure and should not be relied upon on the server.

Recommended Fix: Read strictly from env.LONGCAT\_API\_KEY || process.env.LONGCAT\_API\_KEY.

 Summary of Critical Changes Needed for Module 8:

Fix getSettings Cache Invalidation: Move checkAndAutoLockShareValue inside the cache generator to prevent 2 DB roundtrips per request.

Add aiLimiter Rate Limiter: Protect /api/ai/query against token exhaustion and prompt flooding.

Add 25s Abort Signal Timeout: Prevent hanging sockets on AI proxy requests.

Clean up Environment Variables: Standardize backend API key configuration.

 Verification \& Wait

Module 8 review complete. Reply PROCEED to begin Module 9 (System Middleware, Database Health, Backup \& Infrastructure).



4:38 AM

proceed

4:38 AM





 Module 9 Deep Code Audit \& Performance Review

Target Module: System Middleware, Database Health, Backup \& Infrastructure

 Included Files in this Review:

Backend Infrastructure \& Middleware:



server/src/index.ts

server/src/app.ts

server/src/config/database.ts

server/src/config/env.ts

server/src/middleware/error-handler.ts

server/src/middleware/rate-limiter.ts

server/src/lib/cache.ts

server/src/modules/backup/service.ts

server/src/modules/health/service.ts

server/src/modules/audit/service.ts

Frontend \& Client Reliability:



client/components/ErrorBoundary.tsx

client/components/Settings/BackupRestore.tsx

client/components/Settings/SystemHealth.tsx

 Line-by-Line Audit Findings

1\.  Performance \& I/O Efficiency

[WARNING] Issue 1.1: Health Check Polling Noise in Request Logs

Location: 

server/src/app.ts#L71-L78

Severity: LOW

Problem: Look at lines 71–78:

ts





app.use((req, res, next) => {

&#x20; const start = Date.now();

&#x20; res.on('finish', () => {

&#x20;   const duration = Date.now() - start;

&#x20;   console.log(`\[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);

&#x20; });

&#x20; next();

});

Client dashboards and uptime monitors poll /api/health and /api/ping every 5–10 seconds. Logging each health check probe produces thousands of lines of log noise and synchronous console I/O overhead.

Recommended Fix: Filter out /api/health and /api/ping from standard request logging in development/production:

diff





&#x20;app.use((req, res, next) => {

\+  if (req.path === '/api/health' || req.path === '/api/ping') return next();

&#x20;  const start = Date.now();

&#x20;  res.on('finish', () => {

2\.  Scalability \& Distributed Architecture

[WARNING] Issue 2.1: In-Memory Rate Limiting vs Distributed Multi-Pod Scaling

Location: 

server/src/middleware/rate-limiter.ts#L18-L32

Severity: MEDIUM

Problem: express-rate-limit uses an in-memory Map store. In multi-instance or serverless container configurations (e.g. AWS ECS, Kubernetes pods, Vercel workers), rate-limiting windows are tracked per worker rather than globally.

Recommended Fix: Provide an optional Redis store fallback (rate-limit-redis) when REDIS\_URL is set in the environment.

3\.  Error Boundaries \& Client Resilience

[INFO] Positive Architecture Note:

server/src/middleware/error-handler.ts

&#x20;has an exhaustive mapping of PostgreSQL error codes (23505, 23503, 23502, 42703, 08006, 57014) into clean, sanitized JSON error responses, preventing leakage of database schema structure.

client/components/ErrorBoundary.tsx

&#x20;implements native browser online/offline window events with automatic reconnection detection.

 Summary of Critical Changes Needed for Module 9:

Suppress Health Check Polling in Logger: Filter /api/health and /api/ping from request log output to reduce I/O overhead.

Add Redis-Ready Distributed Store Adapter: Enable shared rate limiting across multi-worker server environments.

 Comprehensive 9-Module Audit Complete!

We have completed the exhaustive line-by-line audit across all 9 modules of the InvestWise ecosystem:



[OK] Module 1: Authentication, Authorization \& Session Management

[OK] Module 2: Ledger Engine, Transactions \& Finance Core

[OK] Module 3: Members \& Share Capital Management

[OK] Module 4: Funds, Dividends, Reserves \& Arrears Engine

[OK] Module 5: Governance, Meetings \& Performance Tracking

[OK] Module 6: Projects, Portfolios \& Project Updates Engine

[OK] Module 7: Analytics, Reporting \& Financial Statement Engine

[OK] Module 8: Goals, AI Advisory \& System Settings

[OK] Module 9: System Middleware, Database Health, Backup \& Infrastructure

