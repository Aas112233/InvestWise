import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const postgres = require(path.resolve('node_modules/postgres'));
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const BASE = 'http://localhost:3001';
let pass=0, fails=0;
const ok=(l,c,d='')=>{console.log((c?'  PASS  ':'  FAIL  ')+l+(d?` — ${d}`:''));c?pass++:fails++;};

async function login(email){
  for(let i=0;i<8;i++){
    const r=await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'pass-12345678'})});
    if(r.status===429){await new Promise(s=>setTimeout(s,(Number(r.headers.get('retry-after')??5)*1000)+200));continue;}
    return {status:r.status,cookies:(r.headers.getSetCookie?.()??[]).map(c=>c.split(';')[0]).join('; ')};
  }
  return {status:429,cookies:''};
}
const A=(await login('admin@meridian.dev')).cookies;

const [t]=await sql`select id from tenants where slug='meridian'`;
// create a fresh SCHEDULED meeting to complete
const {randomUUID}=await import('node:crypto');
const mid=randomUUID();
await sql`insert into meetings (id, tenant_id, title, meeting_date, meeting_type, status)
  values (${mid}, ${t.id}, 'Fuzz Finalize Probe Meeting', now(), 'GENERAL', 'SCHEDULED')`;
// add 3 attendees: 2 present, 1 absent — the absent one should get a penalty
const mems=await sql`select id, warning_count from members where tenant_id=${t.id} and is_deleted=false limit 3`;
for(let i=0;i<mems.length;i++){
  await sql`insert into meeting_attendees (id, tenant_id, meeting_id, member_id, attendance_status, deposit_status)
    values (${randomUUID()}, ${t.id}, ${mid}, ${mems[i].id}, ${i===0?'ABSENT':'PRESENT'}, 'PAID')`;
}
const before=await sql`select count(*)::int n from member_penalties where tenant_id=${t.id} and meeting_id=${mid}`;
ok('no penalties exist before completing', before[0].n===0);

const r=await fetch(`${BASE}/api/meetings/${mid}/complete`,{method:'POST',headers:{Cookie:A,'Content-Type':'application/json'},body:JSON.stringify({notes:'Probe finalization.'})});
const body=await r.json().catch(()=>({}));
ok('POST complete returns 200', r.status===200, `${r.status} ${body?.message}`);
ok('meeting status is COMPLETED', body?.data?.status==='COMPLETED', body?.data?.status);
ok('penalty issued for the absent attendee', (body?.meta?.penaltiesIssued??0)===1, JSON.stringify(body?.meta));
const after=await sql`select count(*)::int n from member_penalties where tenant_id=${t.id} and meeting_id=${mid}`;
ok('DB shows exactly 1 penalty', after[0].n===1, `${after[0].n}`);

// idempotency: re-complete must not double-penalise
const r2=await fetch(`${BASE}/api/meetings/${mid}/complete`,{method:'POST',headers:{Cookie:A,'Content-Type':'application/json'},body:JSON.stringify({})});
const b2=await r2.json().catch(()=>({}));
ok('re-complete returns 200', r2.status===200, `${r2.status}`);
const after2=await sql`select count(*)::int n from member_penalties where tenant_id=${t.id} and meeting_id=${mid}`;
ok('idempotent: still exactly 1 penalty', after2[0].n===1, `${after2[0].n}`);

// cleanup
await sql`delete from member_penalties where meeting_id=${mid}`;
await sql`delete from meeting_attendees where meeting_id=${mid}`;
await sql`delete from meetings where id=${mid}`;
const residue=await sql`select count(*)::int n from meetings where id=${mid}`;
ok('probe meeting cleaned up (no residue)', residue[0].n===0);

console.log(`\n${fails===0?`ALL PASS (${pass})`:`${fails} FAILED`}`);
await sql.end();
process.exit(fails?1:0);
