// Validates the waste team member link in isolated PGlite with synthetic records. Never connects to a remote database.
// Usage: PGLITE_MODULE_PATH=<pglite> node supabase/tests/waste-team-member.mjs <waste team member migration>
import fs from 'node:fs';import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE_PATH||'@electric-sql/pglite');const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`,org=id(100),store=id(200),other=id(201);
await db.exec(`create role anon;create role authenticated;create role automation;create schema private;
create table organization_members(id uuid primary key,organization_id uuid,user_id uuid);
create table hr_team_members(id uuid primary key,organization_id uuid,first_name text,last_name text,status text,location_ids uuid[],member_id uuid);
create table waste_events(id uuid primary key,organization_id uuid,location_id uuid,reported_by uuid,reported_by_name text);
insert into organization_members values('${id(50)}','${org}','${id(60)}');
insert into hr_team_members values
 ('${id(1)}','${org}','Martiese','Sousa','active','{${store}}',null),
 ('${id(2)}','${org}','Ana','Lima','active','{${store}}','${id(50)}'),
 ('${id(3)}','${org}','Joao','Silva','active','{${store}}',null),('${id(4)}','${org}','Joao','Costa','active','{${store}}',null),
 ('${id(5)}','${org}','Carla','Dias','inactive','{${store}}',null),('${id(6)}','${org}','Bruno','Reis','active','{${other}}',null);
insert into waste_events values('${id(10)}','${org}','${store}',null,'Martiese');
grant usage on schema public to automation;grant insert,select,update on waste_events to automation;`);
await db.exec(fs.readFileSync(process.argv[2],'utf8'));
const row=async n=>(await db.query(`select reported_team_member_id m,reported_by_name name from waste_events where id='${id(n)}'`)).rows[0];
assert.deepEqual(await row(10),{m:id(1),name:'Martiese Sousa'},'existing record linked by unique first name');
const add=async(n,by,name,loc=store)=>db.exec(`set role automation;insert into waste_events values('${id(n)}','${org}','${loc}',${by?`'${by}'`:'null'},${name==null?'null':`'${name}'`});reset role;`);
await add(11,id(60),'Signup Name');assert.deepEqual(await row(11),{m:id(2),name:'Ana Lima'},'app user linked through login');
await add(12,null,'joao silva');assert.deepEqual(await row(12),{m:id(3),name:'Joao Silva'},'full name, case-insensitive');
await add(13,null,'Joao');assert.deepEqual(await row(13),{m:null,name:'Joao'},'ambiguous first name stays unlinked');
await add(14,null,'Carla');assert.deepEqual(await row(14),{m:null,name:'Carla'},'inactive member not linked');
await add(15,null,'Bruno');assert.deepEqual(await row(15),{m:null,name:'Bruno'},'member of another location not linked');
await add(16,null,null);assert.deepEqual(await row(16),{m:null,name:null});
await db.exec(`set role automation;update waste_events set reported_by_name='Joao Costa' where id='${id(13)}';reset role;`);assert.deepEqual(await row(13),{m:id(4),name:'Joao Costa'},'renaming relinks');
await db.exec(`update waste_events set reported_by_name='Someone Else' where id='${id(13)}'`);assert.deepEqual(await row(13),{m:null,name:'Someone Else'},'a non-matching rename drops the stale link');
await db.exec(`update waste_events set reported_team_member_id='${id(4)}' where id='${id(13)}'`);assert.deepEqual(await row(13),{m:id(4),name:'Joao Costa'},'explicit assignment wins');
await db.exec(fs.readFileSync(process.argv[2],'utf8'));assert.deepEqual(await row(10),{m:id(1),name:'Martiese Sousa'},'re-running is harmless');
await db.close();console.log('PASS waste team member: login link, full and unique first name, ambiguity/inactive/other-store guards, relink on rename, explicit assignment, automation role');
