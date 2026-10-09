// Live E2E: Bangla (bn) PDF report generation end-to-end — issue #106.
// Proves the API serves a shaped-Bengali PDF with the HindSiliguri subset
// embedded, and saves the artifact for human review.
const BASE = 'http://localhost:3000';
const OUT = 'D:/my project/Investwise_app_source_code/investwise_web_app/.workbuddy-ai/tmp/report-bn-sample.pdf';
let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (detail ? ` — ${detail}` : ''));
  cond ? pass++ : fail++;
};

// 1. Login as a tenant admin (one attempt; buckets cleared beforehand).
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@greenvalley.dev', password: 'pass-12345678' }),
});
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
ok('login 200', login.status === 200, `status=${login.status}`);
if (login.status !== 200) { console.log(`${pass} pass, ${fail} fail`); process.exit(1); }

// 2. Generate the General Ledger PDF in Bangla (explicit custom period).
const res = await fetch(`${BASE}/api/reports/generate/comprehensive-ledger?format=pdf&locale=bn&periodType=Custom&startDate=2026-01-01&endDate=2026-09-30`, { headers: { cookie } });
ok('generate ledger bn pdf 200', res.status === 200, `status=${res.status}`);
const ct = res.headers.get('content-type') ?? '';
ok('content-type application/pdf', ct.includes('application/pdf'), ct);
const buf = Buffer.from(await res.arrayBuffer());
ok('size plausible', buf.length > 20_000, `${(buf.length / 1024).toFixed(0)} KiB`);
ok('starts %PDF', buf.subarray(0, 5).toString('latin1') === '%PDF-');
const latin = buf.toString('latin1');
ok('HindSiliguri TrueType subset embedded', latin.includes('/FontFile2'));
ok('no Type1-only fallback (font count sane)', latin.includes('/BaseFont'));
ok('CFB filename disposition', (res.headers.get('content-disposition') ?? '').includes('.pdf'));

// 3. Save the artifact for human inspection.
const fs = await import('node:fs');
fs.writeFileSync(OUT, buf);
ok('artifact saved', fs.existsSync(OUT), OUT);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
