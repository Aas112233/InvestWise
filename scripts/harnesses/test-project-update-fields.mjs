// Live E2E (#107): project earning/expense form fixes.
// 1. date honored (project_updates + transactions)
// 2. handledByMemberId: member name entry only — NO balance movement anywhere
// 3. negative paths: future date / non-project member / malformed date → 400
// Cleanup: any 'E2E #107' transaction on the project is deleted via the
// standard Expense/Earning reversal endpoint (credits the fund back +
// refunds project totals) before and after the run.
const BASE = 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (detail ? ` — ${detail}` : ''));
  cond ? pass++ : fail++;
};

import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const postgres = require(path.resolve('node_modules/postgres'));
const sql = postgres('postgresql://postgres:postgres@localhost:5432/investwise', { prepare: false });

const dayISO = (d) => d.toISOString().slice(0, 10);

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@greenvalley.dev', password: 'pass-12345678' }),
});
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
ok('login 200', login.status === 200, `status=${login.status}`);
if (login.status !== 200) { console.log(`${pass} pass, ${fail} fail`); process.exit(1); }

// Pick a project with a linked fund and members.
const plist = await (await fetch(`${BASE}/api/projects?limit=100`, { headers: { cookie } })).json();
const projects = plist.data ?? plist;
const project = projects.find((p) => p.linkedFundId && p.currentFundBalance !== undefined);
ok('found project with linked fund', !!project, project?.title ?? 'none');

const pdetail = await (await fetch(`${BASE}/api/projects/${project.id}`, { headers: { cookie } })).json();
const proj = pdetail.data ?? pdetail;
const members = proj.involvedMembers ?? [];
const inProject = members[0];
ok('project has associate members', !!inProject, inProject ? `${inProject.memberName}` : 'none');

const mlist = await (await fetch(`${BASE}/api/members?limit=500`, { headers: { cookie } })).json();
const allMembers = (mlist.data ?? mlist).filter((m) => m.id !== inProject?.memberId);
const outsider = allMembers.find((m) => !members.some((pm) => pm.memberId === m.id));
ok('found non-project member for negative test', !!outsider, outsider?.name ?? 'none');

const findE2eTxns = () => sql`
  select id from transactions
  where project_id = ${project.id} and description like 'E2E #107%' and is_deleted = false`;

// ── Residue cleanup from any previous run ──────────────────────────
const residue = await findE2eTxns();
for (const r of residue) {
  const del = await fetch(`${BASE}/api/transactions/${r.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ reason: 'E2E #107 harness cleanup' }) });
  ok(`residue cleanup ${r.id.slice(0, 8)}`, del.status === 200, `status=${del.status}`);
}

const threeDaysAgo = dayISO(new Date(Date.now() - 3 * 24 * 3600 * 1000));

const [fundBefore] = await sql`select balance from funds where id = ${project.linkedFundId}`;
const [memberBefore] = await sql`select total_contributed from members where id = ${inProject.memberId}`;

// ── 1. Happy path: Expense, backdated + handled-by member ──────────
const post = await fetch(`${BASE}/api/projects/${project.id}/updates`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', cookie },
  body: JSON.stringify({
    type: 'Expense', amount: '1.00', description: 'E2E #107 date+member check',
    date: threeDaysAgo, handledByMemberId: inProject.memberId,
  }),
});
const postBody = await post.json().catch(() => ({}));
ok('posting 201', post.status === 201, `status=${post.status} ${postBody.message ?? ''}`);

if (post.status === 201) {
  const [txn] = await sql`
    select t.id, t.date, t.member_id, t.handling_officer, m.name as member_name
    from transactions t left join members m on m.id = t.member_id
    where t.project_id = ${project.id} and t.description like 'E2E #107 date+member check%'
      and t.is_deleted = false
    order by t.created_at desc limit 1`;
  ok('transaction row exists', !!txn);
  ok('transaction carries chosen date', txn && dayISO(new Date(txn.date)) === threeDaysAgo,
    txn ? String(txn.date) : 'none');
  ok('transaction.member_id = selected member', txn?.member_id === inProject.memberId);
  ok('handling_officer = member name (not operator)', txn?.handling_officer === inProject.memberName,
    txn?.handling_officer ?? 'none');
  const [upd] = await sql`
    select date from project_updates where project_id = ${project.id} order by created_at desc limit 1`;
  ok('project_updates.date = chosen date', upd && dayISO(new Date(upd.date)) === threeDaysAgo,
    upd ? String(upd.date) : 'none');

  const [fundAfter] = await sql`select balance from funds where id = ${project.linkedFundId}`;
  ok('project fund moved by exactly 1.00', Number(fundAfter.balance) === Number(fundBefore.balance) - 1,
    `${fundBefore.balance} -> ${fundAfter.balance}`);
  const [memberAfter] = await sql`select total_contributed from members where id = ${inProject.memberId}`;
  ok('member equity UNCHANGED (name entry only)', Number(memberAfter.total_contributed) === Number(memberBefore.total_contributed),
    `${memberBefore.total_contributed} -> ${memberAfter.total_contributed}`);

  // ── Cleanup: reverse the expense via the standard delete endpoint ──
  const del = await fetch(`${BASE}/api/transactions/${txn.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ reason: 'E2E #107 harness cleanup' }) });
  ok('cleanup: transaction deleted', del.status === 200, `status=${del.status}`);
  const [fundRestored] = await sql`select balance from funds where id = ${project.linkedFundId}`;
  ok('cleanup: fund balance restored', Number(fundRestored.balance) === Number(fundBefore.balance),
    `${fundRestored.balance} vs ${fundBefore.balance}`);
}

// ── 2. Negative paths (no residue) ─────────────────────────────────
const future = dayISO(new Date(Date.now() + 48 * 3600 * 1000));
const r1 = await fetch(`${BASE}/api/projects/${project.id}/updates`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
  body: JSON.stringify({ type: 'Expense', amount: '1', description: 'E2E #107 future', date: future }),
});
ok('future date rejected 400', r1.status === 400, `status=${r1.status}`);

const r2 = await fetch(`${BASE}/api/projects/${project.id}/updates`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
  body: JSON.stringify({ type: 'Expense', amount: '1', description: 'E2E #107 outsider', date: threeDaysAgo, handledByMemberId: outsider?.id }),
});
ok('non-project member rejected 400', r2.status === 400, `status=${r2.status}`);

const r3 = await fetch(`${BASE}/api/projects/${project.id}/updates`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
  body: JSON.stringify({ type: 'Expense', amount: '1', description: 'E2E #107 baddate', date: 'not-a-date' }),
});
ok('malformed date rejected 400', r3.status === 400, `status=${r3.status}`);

// Legacy client (no date, no member) still works — default behavior intact.
const r4 = await fetch(`${BASE}/api/projects/${project.id}/updates`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
  body: JSON.stringify({ type: 'Earning', amount: '1.00', description: 'E2E #107 legacy shape' }),
});
ok('legacy payload (no date/member) still 201', r4.status === 201, `status=${r4.status}`);
if (r4.status === 201) {
  const [txn] = await sql`
    select id, date, member_id from transactions
    where project_id = ${project.id} and description like 'E2E #107 legacy shape%' and is_deleted = false
    order by created_at desc limit 1`;
  const today = dayISO(new Date());
  ok('legacy: date defaults to now', txn && dayISO(new Date(txn.date)) === today, txn ? String(txn.date) : 'none');
  ok('legacy: no member attached', txn?.member_id === null);
  const del = await fetch(`${BASE}/api/transactions/${txn.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ reason: 'E2E #107 harness cleanup' }) });
  ok('cleanup: legacy earning deleted', del.status === 200, `status=${del.status}`);
}

// Final residue check.
const leftover = await findE2eTxns();
ok('no E2E residue left', leftover.length === 0, `left=${leftover.length}`);

await sql.end();
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
