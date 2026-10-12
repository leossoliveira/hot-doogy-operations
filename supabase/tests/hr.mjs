import fs from 'node:fs';import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE_PATH||'@electric-sql/pglite');const db=new PGlite();
const org='6013ed02-626a-497c-b951-619069035532',id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
await db.exec(`create role anon;create role authenticated;create schema auth;create schema private;create type public.member_role as enum('owner','admin','manager','chef','staff');create function auth.uid() returns uuid language sql as $$select '${id(1)}'::uuid$$;create function private.mfa_authorized() returns boolean language sql as $$select current_setting('test.mfa',true)='yes'$$;create function private.has_org_role(o uuid,r public.member_role[]) returns boolean language sql as $$select o::text=current_setting('test.org',true) and current_setting('test.role',true)=any(r::text[])$$;grant usage on schema auth,private to authenticated;
create table organizations(id uuid primary key);create table locations(id uuid primary key,organization_id uuid);create table organization_members(id uuid primary key,organization_id uuid,user_id uuid,role member_role,status text);create table member_location_access(member_id uuid,location_id uuid,primary key(member_id,location_id));create table audit_logs(organization_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,old_data jsonb,new_data jsonb);
insert into organizations values('${org}');insert into locations values('${id(2)}','${org}'),('${id(3)}','${id(99)}');insert into organization_members values('${id(4)}','${org}','${id(5)}','staff','active');set test.role='admin';set test.mfa='yes';set test.org='${org}';`);
await db.exec(fs.readFileSync(process.argv[2],'utf8'));
const save=(kind,n,version,p)=>db.query('select hr_save($1,$2,$3,$4::jsonb) result',[kind,id(n),version,JSON.stringify(p)]);
const team={first_name:'Test',last_name:'Cook',email:'test@example.test',phone:'',status:'active',permission_set:'staff',location_ids:[id(2)],primary_job:'Cook',hourly_rate:20,overtime_rate:30};
await db.exec('set role authenticated');await save('team',10,0,team);await assert.rejects(save('team',11,0,{...team,location_ids:[id(3)]}));await assert.rejects(save('team',10,0,team));
const day={team_member_id:id(10),location_id:id(2),work_date:'2026-01-01',regular_hours:8,overtime_hours:2,status:'approved'};
await save('workday',20,0,day);await save('team',10,1,{...team,hourly_rate:25});await save('workday',20,1,{...day,regular_hours:7});assert.equal((await db.query('select hourly_rate from hr_workdays')).rows[0].hourly_rate,'20.00');
await assert.rejects(save('workday',21,0,{...day,regular_hours:24}));await assert.rejects(save('workday',21,0,{...day,location_id:id(3)}));await assert.rejects(save('workday',21,0,{...day,work_date:'2999-01-01'}));
await assert.rejects(save('access',10,2,{member_id:id(4),permission_set:'admin',location_ids:[id(2)]}));await save('access',10,2,{member_id:id(4),permission_set:'manager',location_ids:[id(2)]});
await assert.rejects(save('team',10,3,{...team,permission_set:'chef'}));
await db.exec("set test.role='staff'");assert.equal((await db.query('select * from hr_team_members')).rows.length,0);await assert.rejects(save('team',12,0,team));await db.exec("set test.role='admin';set test.mfa='no'");assert.equal((await db.query('select * from hr_workdays')).rows.length,0);await assert.rejects(save('team',12,0,team));await db.exec("set test.mfa='yes';set test.org='00000000-0000-0000-0000-000000000099'");assert.equal((await db.query('select * from hr_team_members')).rows.length,0);
await db.exec('reset role');assert.equal((await db.query("select role from organization_members where id='"+id(4)+"'")).rows[0].role,'manager');assert.equal((await db.query('select count(*) n from audit_logs')).rows[0].n,5);assert.equal((await db.query("select has_function_privilege('anon','public.hr_save(text,uuid,integer,jsonb)','execute') allowed")).rows[0].allowed,false);
if(process.argv[3]){
 await db.exec(`create table auth.users(id uuid primary key,email text,phone text);create table profiles(id uuid primary key,full_name text,phone text);insert into auth.users values('${id(5)}','test@example.test',null),('${id(6)}','second@example.test',null);insert into profiles values('${id(6)}','Test Person',null);insert into organization_members values('${id(7)}','${org}','${id(6)}','owner','active');set test.org='${org}';set test.role='admin';set test.mfa='yes';`);
 await db.exec(fs.readFileSync(process.argv[3],'utf8'));
 await db.exec('set role authenticated');let imported=(await db.query('select hr_import_users() r')).rows[0].r;assert.equal(imported.imported,1);assert.equal(imported.skipped,1);assert.equal((await db.query('select hr_import_users() r')).rows[0].r.imported,0);
 const person=(await db.query(`select * from hr_team_members where member_id='${id(7)}'`)).rows[0];assert.equal(person.first_name,'Test');assert.equal(person.last_name,'Person');assert.equal(person.hourly_rate,null);assert.equal(person.permission_set,'owner');
 await assert.rejects(save('workday',29,0,{...day,team_member_id:person.id}));assert.equal((await db.query('select hr_user_directory() r')).rows[0].r.length,2);
 await db.exec("set test.role='staff'");await assert.rejects(db.query('select hr_import_users()'));await assert.rejects(db.query('select hr_user_directory()'));await db.exec('reset role');
}
if(process.argv[4]){
 await db.exec("set test.org='"+org+"';set test.role='owner';set test.mfa='yes';insert into organization_members values('"+id(8)+"','"+org+"','"+id(1)+"','owner','active');");
 await db.exec(fs.readFileSync(process.argv[4],'utf8'));
 const profile=(role,version,permissions)=>db.query('select hr_save_profile($1,$2,$3)',[role,version,permissions]);
 await db.exec('set role authenticated');await profile('staff',0,{inventory:{view:true,write:false}});
 await assert.rejects(profile('staff',0,{}));await assert.rejects(profile('owner',0,{}));await assert.rejects(profile('staff',1,{unknown:{view:true,write:true}}));
 await db.exec("set test.role='admin'");await assert.rejects(profile('admin',0,{}));
 await db.exec("set test.mfa='no'");await assert.rejects(profile('chef',0,{}));await db.exec("set test.mfa='yes';set test.role='staff'");await assert.rejects(profile('chef',0,{}));
 await db.exec("reset role;update organization_members set role='staff' where id='"+id(8)+"';");
 await assert.rejects(db.exec("insert into locations values('"+id(98)+"','"+org+"')"),/permission profile/);
 assert.equal((await db.query("select has_function_privilege('anon','public.hr_save_profile(text,integer,jsonb)','execute') allowed")).rows[0].allowed,false);
 console.log('PASS profile versioning, validation, owner/admin/MFA checks and direct write guard');
}

if(process.argv[5]){
 await db.exec(`reset role;update organization_members set role='owner' where id='${id(8)}';set test.role='owner';set test.org='${org}';set test.mfa='yes';`);
 await db.exec(fs.readFileSync(process.argv[5],'utf8'));
 await db.exec('set role authenticated');
 await save('team',40,0,{...team,primary_job:'',hourly_rate:'',overtime_rate:'',phone:'+5511999999999',phone_country:'BR'});
 const optional=(await db.query('select * from hr_team_members where id=$1',[id(40)])).rows[0];
 assert.equal(optional.primary_job,null);assert.equal(optional.hourly_rate,null);assert.equal(optional.phone_country,'BR');
 await assert.rejects(save('workday',41,0,{...day,team_member_id:id(40)}));
 const deactivate=(n,v)=>db.query('select hr_deactivate($1,$2)',[id(n),v]);
 await assert.rejects(deactivate(10,2));
 await db.exec("set test.mfa='no'");await assert.rejects(deactivate(10,3));await db.exec("set test.mfa='yes';set test.role='staff'");await assert.rejects(deactivate(10,3));await db.exec("set test.role='owner'");
 const owner=(await db.query('select id,version from hr_team_members where member_id=$1',[id(7)])).rows[0];
 await assert.rejects(db.query('select hr_deactivate($1,$2)',[owner.id,owner.version]));
 await deactivate(10,3);
 assert.equal((await db.query('select status from hr_team_members where id=$1',[id(10)])).rows[0].status,'inactive');
 await db.exec('reset role');assert.equal((await db.query('select status from organization_members where id=$1',[id(4)])).rows[0].status,'inactive');
 assert.equal((await db.query('select hourly_rate from hr_workdays where id=$1',[id(20)])).rows[0].hourly_rate,'20.00');
 assert.equal((await db.query("select has_function_privilege('anon','public.hr_deactivate(uuid,integer)','execute') allowed")).rows[0].allowed,false);
 console.log('PASS optional compensation, country phone, deactivation authorization/version/owner protection, membership block and retained wage history');
}
if(process.argv[6])await (await import('./team-operations.mjs')).verifyTeamOperations(db,{org,id,save,team,path:process.argv[6]});
if(process.argv[7])await (await import('./receipt-team.mjs')).verifyReceiptTeam(db,{org,id,path:process.argv[7]});
await db.close();console.log('PASS HR: team/workday saves, wage history, stale edits, locations, hours, future dates, role assignment, RLS tenant/MFA/staff denial, audit, anonymous denial');
