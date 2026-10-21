import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
const db=new PGlite();
const fixture=JSON.parse(await readFile(new URL('./fixtures/list-read-policies.json',import.meta.url),'utf8'));
const migration=await readFile(new URL('../migrations/20261021012310_workspace_list_read_performance.sql',import.meta.url),'utf8');
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const columns=['organization_id','location_id','storage_area_id','default_storage_area_id','output_storage_area_id','filter_storage_area_id','filter_supplier_id','supplier_id','invoice_id','receipt_id','purchase_order_id','recipe_id','recipe_version_id','stock_count_id','stock_count_line_id','prep_batch_id','waste_event_id'];
await db.exec(`create schema private;create schema auth;create role authenticated;create role anon;
create type public.member_role as enum ('owner','admin','manager','chef','staff');
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create table public.organization_members(id uuid primary key,organization_id uuid,user_id uuid,status text,role public.member_role);
create table public.member_location_access(member_id uuid,location_id uuid);
create table public.member_storage_area_access(member_id uuid,storage_area_id uuid,can_view boolean);
create table public.member_supplier_access(member_id uuid,supplier_id uuid,can_view boolean);
grant usage on schema private,auth to authenticated;
`);
for(const {tablename} of fixture.policies)await db.exec(`create table public.${tablename}(id uuid primary key,${columns.map(c=>c+' uuid').join(',')},is_system boolean default false);`);
for(const helper of fixture.helpers)await db.exec(helper.definition);
await db.exec(`alter table organization_members enable row level security;
create policy own_membership on organization_members for select to authenticated using(user_id=(select auth.uid()) or private.has_org_role(organization_id,array['owner','admin']::member_role[]));
insert into organization_members values('${uid(900)}','${uid(1)}','${uid(900)}','active','owner'),('${uid(901)}','${uid(2)}','${uid(901)}','active','owner');
insert into member_location_access values('${uid(900)}','${uid(101)}');
insert into member_storage_area_access values('${uid(900)}','${uid(101)}',true);
insert into member_supplier_access values('${uid(900)}','${uid(101)}',true);`);
for(const {tablename,qual} of fixture.policies){
 await db.exec(`alter table public.${tablename} enable row level security;
 create policy rm2_select on public.${tablename} for select to authenticated using(${qual});
 create policy mfa_required on public.${tablename} as restrictive for select to authenticated using((select current_setting('test.mfa',true))='yes');
 create policy unchanged_write on public.${tablename} for update to authenticated using(false) with check(false);`);
 for(let n=1;n<=8;n++){
  const id=uid(100+n),org=uid(n===3?2:1);
  const values=columns.map(c=>c==='organization_id'?org:n===4?null:n===5&&c.includes('storage')?uid(102):n===6&&c==='supplier_id'?uid(102):n===7&&c.includes('storage')?uid(999):n===8&&c==='location_id'?uid(999):id);
  await db.query(`insert into public.${tablename}(id,${columns.join(',')},is_system) values($1,${columns.map((_,i)=>'$'+(i+2)).join(',')},false)`,[id,...values]);
 }
}
await db.exec('grant select on all tables in schema public to authenticated;');
const scenarios=[];
for(const role of ['owner','admin','manager','chef','staff'])for(const mfa of ['yes','no'])scenarios.push({role,mfa,user:900,status:'active',granted:true});
scenarios.push({role:'manager',mfa:'yes',user:900,status:'active',granted:false},{role:'owner',mfa:'yes',user:900,status:'suspended',granted:true},{role:'owner',mfa:'yes',user:901,status:'active',granted:true},{role:'owner',mfa:'yes',user:999,status:'active',granted:true},{role:'owner',mfa:'yes',user:null,status:'active',granted:true});
async function snapshots(){
 const results=[];
 for(const s of scenarios){
  await db.exec(`reset role;update organization_members set role='${s.role}',status='${s.status}' where user_id='${uid(900)}';delete from member_location_access;${s.granted?`insert into member_location_access values('${uid(900)}','${uid(101)}');`:''}set test.uid='${s.user?uid(s.user):''}';set test.mfa='${s.mfa}';set role authenticated;`);
  const rows={};for(const {tablename} of fixture.policies)rows[tablename]=(await db.query(`select id from public.${tablename} order by id`)).rows.map(r=>r.id);
  results.push(rows);
 }
 await db.exec('reset role;');return results;
}
const before=await snapshots();
async function benchmark(){
 await db.exec(`begin;update organization_members set role='owner',status='active' where user_id='${uid(900)}';
 insert into inventory_transactions(id,organization_id,location_id,storage_area_id)
 select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${uid(1)}','${uid(101)}','${uid(101)}' from generate_series(1,2400) n;
 set local test.uid='${uid(900)}';set local test.mfa='yes';set local role authenticated;`);
 const result=await db.query(`explain(analyze,format json) select * from inventory_transactions where organization_id='${uid(1)}' order by id limit 500`);
 await db.exec('rollback');const plan=result.rows[0]['QUERY PLAN'][0];assert.equal(plan.Plan['Actual Rows'],500);return plan['Execution Time'];
}
const beforeMs=await benchmark();
assert.ok(before[0].inventory_transactions.length>0);
assert.equal(before[1].inventory_transactions.length,0);
assert.deepEqual(before[4].inventory_transactions,[uid(101),uid(104)]);
assert.equal(before[8].inventory_transactions.length,0);
const untouched=async()=>(await db.query("select tablename,policyname,qual,with_check from pg_policies where policyname <> 'rm2_select' order by tablename,policyname")).rows;
const otherPolicies=await untouched();
await db.exec(migration);
assert.deepEqual(await snapshots(),before,'Every role, tenant, location, storage, supplier, NULL and revoked access must retain the same visible rows.');
assert.deepEqual(await untouched(),otherPolicies,'Write and restrictive policies must not change.');
const afterMs=await benchmark();
const plans=await db.query("select qual from pg_policies where tablename='inventory_transactions' and policyname='rm2_select'");
assert.ok(!/private\.(can_storage|can_location|has_org_role|is_org_member)\(/.test(plans.rows[0].qual));
await db.close();
console.log(`List read policies: ${fixture.policies.length} tables × ${scenarios.length} authorization scenarios match; restrictive and write policies unchanged.`);
console.log(`Synthetic 2,400-movement database, 500-row authenticated read: ${beforeMs.toFixed(1)} ms before → ${afterMs.toFixed(1)} ms after (isolated PGlite).`);
