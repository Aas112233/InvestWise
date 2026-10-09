// Verify the members DELETE guard: a member with linked transactions MUST be
// un-deletable. Tests both the guard and the soft-delete-vs-balance question.
import postgres from 'postgres';
const BASE = process.env.BASE_URL || 'http://localhost:3001';
const sql = postgres(process.env.DATABASE_URL,{prepare:false});
async function login(email){
  const r=await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'pass-12345678'})});
  return (r.headers.getSetCookie?.()??[]).map(c=>c.split(';')[0]).join('; ');
}
async function api(method,path,cookies,payload){
  const r=await fetch(`${BASE}${path}`,{method,headers:{Cookie:cookies,'Content-Type':'application/json'},body:payload!==undefined?JSON.stringify(payload):undefined});
  let body=null; try{body=await r.json();}catch{}
  return {status:r.status,body};
}
const gv=(await sql`select id from tenants where name ilike '%green%'`)[0].id;
const A=await login('admin@greenvalley.dev');

// Find a LIVE member that already has transactions.
const target=(await sql`
  select m.id, m.member_id, m.name,
    (select count(*)::int from transactions t where t.member_id=m.id) tx
  from members m
  where m.tenant_id=${gv} and m.is_deleted=false
    and exists (select 1 from transactions t where t.member_id=m.id)
  limit 1`)[0];
console.log('target:', target.member_id, target.name, 'tx=',target.tx);

const del=await api('DELETE',`/api/members/${target.id}`,A,{reason:'e2e guard probe'});
console.log('delete status:',del.status);
console.log('message:',del.body?.message);
console.log('guard held:', del.status===400);
const after=(await sql`select is_deleted from members where id=${target.id}`)[0];
console.log('still live in DB:', after.is_deleted===false);
await sql.end();
process.exit(del.status===400 && after.is_deleted===false ? 0 : 1);
