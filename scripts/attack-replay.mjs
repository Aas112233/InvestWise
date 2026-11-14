#!/usr/bin/env node
/**
 * Attack rehearsal: parallel-twin replay against a write endpoint.
 *
 * The static guarantee is "the route has a row lock + an idempotency
 * dup-check". The live guarantee is that N concurrent twins produce EXACTLY
 * ONE ledger effect. This harness closes that gap: it fires N identical
 * requests at the same instant and reports how many were admitted, so a
 * missing FOR UPDATE, a dup-check outside the transaction, or a lock ordering
 * bug shows up as admittedCount > 1.
 *
 * Usage:
 *   node scripts/attack-replay.mjs <baseUrl> <cookieOrBearer> <endpoint> <jsonBody> [n]
 *
 * Example (distribute-returns twin replay):
 *   node scripts/attack-replay.mjs http://localhost:3000 \
 *     "accessToken=eyJ..." \
 *     /api/projects/00000000-0000-0000-0000-000000000001/distribute-returns \
 *     '{"type":"Profit","amount":1000,"description":"replay rehearsal"}' 10
 *
 * Exit codes: 0 = safe (exactly one 2xx), 1 = REPLAY VULNERABILITY (multiple
 * admitted), 2 = inconclusive (all rejected — fix auth/target id first).
 *
 * NOTE: run only against a LOCAL/dev database. A real run mutates the ledger;
 * the point of the rehearsal is to catch it in a disposable environment.
 */

const [baseUrl, auth, endpoint, jsonBody, nArg] = process.argv.slice(2);

if (!baseUrl || !auth || !endpoint || !jsonBody) {
  console.error('Usage: node scripts/attack-replay.mjs <baseUrl> <cookieOrBearer> <endpoint> <jsonBody> [n]');
  process.exit(2);
}

const N = Math.max(2, Number(nArg) || 10);
const url = new URL(endpoint, baseUrl).toString();
const isBearer = auth.startsWith('Bearer ');
const headers = {
  'Content-Type': 'application/json',
  ...(isBearer ? { Authorization: auth } : { Cookie: auth }),
};
const body = jsonBody;

console.log(`Rehearsal: ${N} concurrent twins -> ${url}`);

// Fire truly concurrently: one preflight-less burst, all in the same tick.
const results = await Promise.allSettled(
  Array.from({ length: N }, () =>
    fetch(url, { method: 'POST', headers, body, redirect: 'manual' }),
  ),
);

let admitted = 0;
let rejected = 0;
let other = 0;
for (const r of results) {
  if (r.status !== 'fulfilled') {
    other += 1;
    continue;
  }
  const res = r.value;
  const text = await res.text().catch(() => '');
  if (res.status >= 200 && res.status < 300) {
    admitted += 1;
    console.log(`  ADMITTED ${res.status}: ${text.slice(0, 140)}`);
  } else if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 409 || res.status === 423 || res.status === 429) {
    rejected += 1;
  } else {
    other += 1;
    console.log(`  ${res.status}: ${text.slice(0, 140)}`);
  }
}

console.log(`admitted=${admitted} rejected=${rejected} other=${other} of ${N}`);

if (admitted === 1) {
  console.log('SAFE: exactly one twin was admitted — idempotency + locking held.');
  process.exit(0);
}
if (admitted === 0) {
  console.log('INCONCLUSIVE: nothing was admitted — check auth/session/target id against the dev database.');
  process.exit(2);
}
console.log('REPLAY VULNERABILITY: more than one twin produced a 2xx — the ledger was mutated more than once.');
process.exit(1);
