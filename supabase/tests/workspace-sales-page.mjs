import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {FACT_COLUMNS} from '../../server/live-data.mjs';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
const db=new PGlite(),uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const org=uid(1),other=uid(2),actor=uid(10),loc=uid(20),hidden=uid(21);
await db.exec(`set enable_seqscan=on;set random_page_cost=1.1;
create schema private;create schema auth;create role authenticated;create role anon;
create table organization_members(organization_id uuid,user_id uuid,role text,status text);
create table locations(id uuid primary key,organization_id uuid);
create table member_locations(user_id uuid,location_id uuid);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create function private.mfa_authorized() returns boolean language sql stable security definer set search_path='' as $$select current_setting('test.mfa',true)='yes' and current_setting('test.session',true)='active'$$;
create function private.is_operations_staff() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.organization_members where user_id=auth.uid() and role='staff' and status='active')$$;
create function private.is_org_member(uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.organization_members where user_id=auth.uid() and organization_id=$1 and status='active')$$;
create function private.can_location(uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.organization_members m join public.locations l on l.organization_id=m.organization_id where m.user_id=auth.uid() and m.status='active' and l.id=$1 and (m.role in ('owner','admin') or exists(select 1 from public.member_locations a where a.user_id=m.user_id and a.location_id=l.id)))$$;
create table sales_item_facts(id uuid primary key,organization_id uuid,location_id uuid,menu_item_id uuid,source_row_id uuid,import_batch_id uuid,fact_date date,granularity text,period_start timestamptz,period_end timestamptz,quantity numeric,net_sales numeric,gross_sales numeric,discounts numeric,refunds numeric,external_item_id text,external_item_name text,unused text);
create index on sales_item_facts(organization_id);
alter table sales_item_facts enable row level security;alter table locations enable row level security;
create policy location_scope on locations for select to authenticated using(private.can_location(id));
create policy mfa_required on locations as restrictive for all to authenticated using((select private.mfa_authorized()));
create policy rm2_select on sales_item_facts for select to authenticated using(organization_id in(select organization_id from organization_members where user_id=(select auth.uid()) and status='active' and role in ('owner','admin','manager')) and (location_id is null or location_id in(select id from locations)));
create policy mfa_required on sales_item_facts as restrictive for all to authenticated using((select private.mfa_authorized()));
create policy staff_no_read on sales_item_facts as restrictive for select to authenticated using(not(select private.is_operations_staff()));
create policy write_scope on sales_item_facts for update to authenticated using(private.is_org_member(organization_id) and private.can_location(location_id) and not private.is_operations_staff()) with check(private.is_org_member(organization_id) and private.can_location(location_id) and not private.is_operations_staff());
grant usage on schema private,auth to authenticated;grant select on all tables in schema public to authenticated;grant update on sales_item_facts to authenticated;
insert into organization_members values('${org}','${actor}','owner','active'),('${other}','${uid(11)}','owner','active');
insert into locations values('${loc}','${org}'),('${hidden}','${org}'),('${uid(22)}','${other}');
insert into member_locations values('${actor}','${loc}');
insert into sales_item_facts select md5(n::text)::uuid,'${org}',case when n%10=0 then null when n%3=0 then '${hidden}'::uuid else '${loc}'::uuid end,md5((n+1)::text)::uuid,md5((n+2)::text)::uuid,md5((n+3)::text)::uuid,'2026-10-01','transaction',now(),now(),n%5,n%100,n%120,0,0,(n%200)::text,'Menu '||(n%200),repeat(md5(n::text),35) from generate_series(1,16050)n;
insert into sales_item_facts(id,organization_id,location_id,external_item_name) values('${uid(99)}','${other}','${uid(22)}','Foreign');
set test.uid='${actor}';set test.mfa='yes';set test.session='active';`);
await db.exec('vacuum analyze sales_item_facts');
const migration=await readFile(new URL('../migrations/20261023120837_indexed_workspace_sales_pages.sql',import.meta.url),'utf8');
const policies=async()=>(await db.query('select tablename,policyname,qual,with_check from pg_policies order by tablename,policyname')).rows;
const beforePolicies=await policies();
const select=FACT_COLUMNS.join(','),baseline=`select ${select} from sales_item_facts where organization_id='${org}' order by id limit 1000`;
await db.exec('set role authenticated');
const beforePlan=(await db.query(`explain(analyze,format json) select coalesce(jsonb_agg(to_jsonb(page) order by page.id),'[]'::jsonb) from (${baseline}) page`)).rows[0]['QUERY PLAN'][0];
const baselineRows=async()=>(await db.query(`select coalesce(jsonb_agg(to_jsonb(page)),'[]'::jsonb) data from (${baseline}) page`)).rows[0].data;
const first=await baselineRows();
await db.exec('reset role');await db.exec(migration);
assert.deepEqual(await policies(),beforePolicies,'All existing read/write/restrictive policies must remain identical.');
const fn=(await db.query("select prosecdef,provolatile from pg_proc where proname='workspace_sales_page'")).rows[0];assert.equal(fn.prosecdef,false);assert.equal(fn.provolatile,'s');
assert.equal((await db.query("select has_function_privilege('anon','public.workspace_sales_page(uuid,uuid,uuid,uuid,integer)','execute') allowed")).rows[0].allowed,false);
await db.exec('set role authenticated');
const call=async({organization=org,after=null,lower=null,upper=null,limit=1000}={})=>(await db.query('select public.workspace_sales_page($1,$2,$3,$4,$5) data',[organization,after,lower,upper,limit])).rows[0].data;
const normalized=rows=>JSON.parse(JSON.stringify(rows));
assert.deepEqual(await call(),normalized(first));
assert.deepEqual((await db.query('select public.workspace_read_batch($1,$2) data',[org,['sales_item_facts']])).rows[0].data.sales_item_facts,await call());
// Exhaustive disjoint UUID ranges, matching the server's continuation algorithm.
const all=[...await call()],cursor=all.at(-1).id,bounds=['00000000-0000-0000-0000-000000000000','40000000-0000-0000-0000-000000000000','80000000-0000-0000-0000-000000000000','c0000000-0000-0000-0000-000000000000'];
for(let i=0;i<bounds.length;i++){
 let after=cursor;for(;;){const page=await call({after,lower:bounds[i],upper:bounds[i+1]||null});all.push(...page);if(page.length<1000)break;after=page.at(-1).id;}
}
assert.equal(all.length,16050);assert.equal(new Set(all.map(r=>r.id)).size,16050);assert.deepEqual(all.map(r=>r.id),all.map(r=>r.id).sort());
for(const role of ['owner','admin','manager','chef','staff']){
 await db.exec(`reset role;update organization_members set role='${role}' where user_id='${actor}';set role authenticated;`);
 const expected=await baselineRows();assert.deepEqual(await call(),expected,role+' must retain identical visible rows.');
 if(role==='staff')assert.equal((await db.query('update sales_item_facts set net_sales=1 returning id')).rows.length,0);
}
await assert.rejects(call({organization:other}),e=>e.code==='42501');
for(const args of [{limit:0},{limit:1001},{limit:null},{lower:bounds[2],upper:bounds[1]}])await assert.rejects(call(args),e=>e.code==='22023');
for(const setting of ['test.mfa','test.session']){await db.query('select set_config($1,$2,false)',[setting,'no']);await assert.rejects(call(),e=>e.code==='42501');await db.query('select set_config($1,$2,false)',[setting,setting==='test.mfa'?'yes':'active']);}
await db.exec(`reset role;update organization_members set role='owner',status='suspended' where user_id='${actor}';set role authenticated;`);await assert.rejects(call(),e=>e.code==='42501');
await db.exec(`reset role;update organization_members set status='active' where user_id='${actor}';set role authenticated;set test.uid='';`);await assert.rejects(call(),e=>e.code==='42501');
await db.exec(`set test.uid='${actor}';`);
assert.equal((await db.query("update sales_item_facts set net_sales=net_sales where id=(select id from sales_item_facts where organization_id=$1 and location_id is not null order by id limit 1) returning id",[org])).rows.length,1);
assert.equal((await db.query("update sales_item_facts set net_sales=1 where organization_id=$1 returning id",[other])).rows.length,0);
await db.exec('reset role');
// An unbounded name is not an indexed payload and must remain writable.
await db.query('update sales_item_facts set external_item_name=$1 where id=$2',['x'.repeat(12000),first[0].id]);
await db.exec('vacuum analyze sales_item_facts');await db.exec('set role authenticated');
assert.equal((await call())[0].external_item_name.length,12000);
await db.exec('reset role');await db.query('update sales_item_facts set external_item_name=$1 where id=$2',[first[0].external_item_name,first[0].id]);await db.exec('vacuum analyze sales_item_facts');await db.exec('set role authenticated');
// Explain the exact inner query used by the function, with its bound page values.
const inner=migration.split('execute $query$')[1].split('$query$ into')[0];
const afterPlan=(await db.query('explain(analyze,format json) '+inner,[org,null,null,null,1000])).rows[0]['QUERY PLAN'][0];
const nodes=[];function walk(p){nodes.push(p);for(const c of p.Plans||[])walk(c);}walk(afterPlan.Plan);
assert.ok(nodes.some(p=>p['Node Type']==='Index Only Scan'&&p['Index Name']==='sales_item_facts_workspace_page_idx'));
assert.ok(!nodes.some(p=>p['Node Type']==='Seq Scan'&&p['Relation Name']==='sales_item_facts'));
await db.exec('reset role;revoke select on sales_item_facts from authenticated;set role authenticated;');await assert.rejects(call(),e=>e.code==='42501');
await db.close();console.log('PASS sales pagination: 16,050 complete ordered rows; five roles, tenant/location scope, MFA/session/revocation, bounds, writes, long names, batch integration, invoker permissions.');
console.log(`Synthetic authenticated first page: ${beforePlan['Execution Time']} ms → ${afterPlan['Execution Time']} ms; full history scan replaced by bounded index lookup.`);
