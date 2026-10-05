// Run against an isolated PostgreSQL WASM instance, never production.
// PGLITE_MODULE_PATH=/tmp/hot-doogy-mfa-test/node_modules/@electric-sql/pglite/dist/index.js node scripts/verify-mfa-database.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
const db=new PGlite();
const u='00000000-0000-4000-8000-000000000001',s='00000000-0000-4000-8000-000000000002',factor='00000000-0000-4000-8000-000000000003',org='00000000-0000-4000-8000-000000000004',loc='00000000-0000-4000-8000-000000000005',member='00000000-0000-4000-8000-000000000006',supplier='00000000-0000-4000-8000-000000000007',area='00000000-0000-4000-8000-000000000008',other='00000000-0000-4000-8000-000000000009';
try{
 await db.exec(`
 create role anon;create role authenticated;create schema auth;create schema private;create schema storage;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 create table auth.sessions(id uuid,user_id uuid,factor_id uuid,aal text,not_after timestamptz);
 create table auth.mfa_factors(id uuid,user_id uuid,status text);
 create type public.member_role as enum('owner','admin','manager','chef');
 create table public.organization_members(id uuid,user_id uuid,organization_id uuid,role public.member_role,status text);
 create table public.locations(id uuid,organization_id uuid);
 create table public.storage_areas(id uuid,organization_id uuid,location_id uuid);
 create table public.suppliers(id uuid,organization_id uuid);
 create table public.member_location_access(member_id uuid,location_id uuid);
 create table public.member_storage_area_access(member_id uuid,storage_area_id uuid,can_view boolean);
 create table public.member_supplier_access(member_id uuid,supplier_id uuid,can_view boolean);
 create table public.mfa_test_records(id int,organization_id uuid);
 create table storage.objects(id int);
 alter table public.organization_members enable row level security;
 alter table public.mfa_test_records enable row level security;
 alter table storage.objects enable row level security;
 grant usage on schema auth,private,public,storage to authenticated;
 grant select,insert,update,delete on all tables in schema public,storage to authenticated;
 insert into public.organization_members values('${member}','${u}','${org}','admin','active');
 insert into public.organization_members values('${other}','${other}','${org}','manager','active');
 insert into public.locations values('${loc}','${org}');
 insert into public.suppliers values('${supplier}','${org}');
 insert into public.storage_areas values('${area}','${org}','${loc}');
 insert into public.member_location_access values('${member}','${loc}');
 insert into public.mfa_test_records values(1,'${org}'),(2,'${other}');
 insert into storage.objects values(1);
 insert into auth.sessions values('${s}','${u}',null,'aal1',null);
 `);
 const migration=await readFile(new URL('../database/security-mfa.sql',import.meta.url),'utf8');
 await db.exec(migration);await db.exec(migration); // Applying twice must retain the same restrictions.
 await db.exec(`
 create policy test_member_read on public.organization_members for select to authenticated using(user_id=auth.uid() or private.has_org_role(organization_id,array['owner','admin']::public.member_role[]));
 create policy test_records_access on public.mfa_test_records for all to authenticated using(private.is_org_member(organization_id)) with check(private.is_org_member(organization_id));
 create policy test_storage_access on storage.objects for all to authenticated using(true) with check(true);
 create view public.mfa_test_view with(security_invoker=true) as select * from public.mfa_test_records;
 grant select on public.mfa_test_view to authenticated;
 create function private.mfa_test_rpc() returns int language plpgsql security definer set search_path='' as $$begin
 if not private.has_org_role('${org}',array['owner','admin','manager']::public.member_role[]) then raise exception 'Forbidden' using errcode='42501';end if;
 return (select count(*) from public.mfa_test_records where organization_id='${org}');end $$;
 revoke all on function private.mfa_test_rpc() from public;
 grant execute on function private.mfa_test_rpc() to authenticated;
 `);
 async function asUser(aal,query){await db.exec(`set role authenticated;set request.jwt.claims='${JSON.stringify({sub:u,session_id:s,aal,role:'authenticated'})}';`);try{return (await db.query(query)).rows;}finally{await db.exec('reset role');}}
 const status=async aal=>(await asUser(aal,'select public.operations_auth_status() as s'))[0].s;
 assert.deepEqual(await status('aal1'),{active:true,mfa_verified:false,allowed:false});
 assert.equal((await asUser('aal1','select * from public.organization_members')).length,1);
 assert.equal((await asUser('aal1','select * from public.mfa_test_records')).length,0);
 assert.equal((await asUser('aal1','select * from public.mfa_test_view')).length,0);
 assert.equal((await asUser('aal1','select * from storage.objects')).length,0);
 await assert.rejects(asUser('aal1','select private.mfa_test_rpc()'),/Forbidden/);
 await assert.rejects(asUser('aal1',`insert into public.mfa_test_records values(3,'${org}')`),/row-level security/);
 assert.equal((await asUser('aal1','update public.mfa_test_records set id=4 returning *')).length,0);
 assert.equal((await status('aal2')).allowed,false); // JWT level alone is not enough.
 await db.exec(`insert into auth.mfa_factors values('${factor}','${u}','verified');update auth.sessions set aal='aal2',factor_id='${factor}';`);
 assert.deepEqual(await status('aal2'),{active:true,mfa_verified:true,allowed:true});
 assert.equal((await asUser('aal2','select * from public.mfa_test_records')).length,1); // Other org still excluded.
 assert.equal((await asUser('aal2','select * from public.mfa_test_view')).length,1);
 assert.equal((await asUser('aal2','select * from storage.objects')).length,1);
 assert.equal((await asUser('aal2','select private.mfa_test_rpc() as n'))[0].n,1);
 for(const [fn,arg] of [['can_location',loc],['can_storage',area],['can_supplier',supplier]])assert.equal((await asUser('aal2',`select private.${fn}('${arg}') as allowed`))[0].allowed,true);
 assert.equal((await status('aal1')).allowed,false); // Old AAL1 token cannot inherit session promotion.
 await db.exec(`update auth.sessions set not_after=now()-interval '1 second'`);assert.equal((await status('aal2')).active,false);
 await db.exec('update auth.sessions set not_after=null;delete from auth.mfa_factors');assert.equal((await status('aal2')).allowed,false);
 await db.exec(`update public.organization_members set role='manager' where user_id='${u}';update auth.sessions set aal='aal1',factor_id=null`);
 assert.equal((await status('aal1')).allowed,true); // Unenrolled non-admin unchanged.
 await db.exec(`insert into auth.mfa_factors values('${factor}','${u}','verified')`);assert.equal((await status('aal1')).allowed,false);
 await db.exec('delete from auth.sessions');assert.equal((await status('aal2')).allowed,false);
 const acl=(await db.query("select has_function_privilege('anon','public.operations_auth_status()','execute') as anon,has_function_privilege('authenticated','private.auth_mfa_verified()','execute') as internal")).rows[0];assert.deepEqual(acl,{anon:false,internal:false});
 console.log('MFA SQL verified: enrollment bootstrap, RLS reads/writes, invoker view, Storage, privileged helper/RPC, tenant isolation, revoked/expired sessions, factor removal, role changes and restricted grants.');
}catch(error){console.error(error.message);process.exitCode=1;}finally{await db.close();}
