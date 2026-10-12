import fs from 'node:fs';import assert from 'node:assert/strict';
export async function verifyTeamLocations(db,{org,id,save,team,path}){
 await db.exec(`reset role;set test.role='owner';set test.mfa='yes';insert into locations values('${id(50)}','${org}');`);
 await db.exec(fs.readFileSync(path,'utf8'));
 await db.exec('set role authenticated');
 let person=(await db.query('select * from hr_team_members where id=$1',[id(10)])).rows[0];
 await save('team',10,person.version,{...team,status:'inactive',permission_set:'manager',location_ids:[id(50)]});
 await db.exec('reset role');
 assert.deepEqual((await db.query('select location_id from member_location_access where member_id=$1',[id(4)])).rows.map(x=>x.location_id),[id(50)]);
 person=(await db.query('select * from hr_team_members where id=$1',[id(10)])).rows[0];
 assert.deepEqual(person.location_ids,[id(50)]);
 await db.exec(`update organization_members set status='active' where id='${id(4)}';set role authenticated;`);
 await assert.rejects(save('team',10,person.version,{...team,permission_set:'manager',location_ids:[id(3)]}),/invalid locations/);
 await assert.rejects(save('team',10,person.version,{...team,permission_set:'admin',location_ids:[id(50)]}),/Permissions/);
 await assert.rejects(save('team',10,person.version-1,{...team,permission_set:'manager',location_ids:[id(50)]}),/changed/);
 await save('access',10,person.version,{member_id:id(4),permission_set:'chef',location_ids:[id(2)]});
 await db.exec('reset role');
 assert.deepEqual((await db.query('select location_id from member_location_access where member_id=$1',[id(4)])).rows.map(x=>x.location_id),[id(50)]);
 person=(await db.query('select * from hr_team_members where id=$1',[id(10)])).rows[0];
 await db.exec('set role authenticated');
 await save('access',10,person.version,{member_id:id(4),permission_set:'staff'});
 const owner=(await db.query('select * from hr_team_members where member_id=$1',[id(7)])).rows[0];
 await db.exec("set test.role='admin'");
 await assert.rejects(db.query('select hr_save($1,$2,$3,$4::jsonb)',['team',owner.id,owner.version,JSON.stringify({...team,permission_set:'owner',location_ids:[id(50)]})]),/only owners/);
 await db.exec("reset role;set test.role='owner'");
 assert.equal((await db.query('select role from organization_members where id=$1',[id(4)])).rows[0].role,'staff');
 assert.deepEqual((await db.query('select location_ids from hr_team_members where id=$1',[id(10)])).rows[0].location_ids,[id(50)]);
 console.log('PASS Team location sync, Permissions preserves locations, stale/foreign/role escalation denied');
}
