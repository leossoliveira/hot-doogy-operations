import fs from 'node:fs';import assert from 'node:assert/strict';
export async function verifyTeamOperations(db,{org,id,save,team,path}){
 await db.exec(`reset role;set test.role='owner';set test.mfa='yes';set test.org='${org}';
 create function private.can_location(x uuid) returns boolean language sql as $$select x='${id(2)}'::uuid$$;
 create function private.can_supplier(x uuid) returns boolean language sql as $$select x='${id(3)}'::uuid$$;
 alter table audit_logs add column location_id uuid;
 create table invoices(id uuid primary key,organization_id uuid,location_id uuid,supplier_id uuid,updated_at timestamptz default now(),extraction jsonb);
 create table prep_batches(id uuid primary key,organization_id uuid,location_id uuid,updated_at timestamptz default now());
 create function private.web_operation(p_action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $func$
 #variable_conflict use_variable
 declare org uuid:='${org}';id uuid:=(p->>'id')::uuid;loc uuid:=(p->>'locationId')::uuid;
 begin if p_action='production' then insert into public.prep_batches(id,organization_id,location_id) values(id,org,loc);elsif p_action='invoices' then null;end if;return '{}';end $func$;
 create function public.approve_invoice_review(uuid,timestamptz,text,date,text,text,text,date) returns jsonb language plpgsql as $$begin update invoices set extraction=jsonb_build_object('receiving',jsonb_build_object('status',$6,'receivedBy',$7)) where id=$1;return '{}';end$$;`);
 await db.exec(fs.readFileSync(path,'utf8'));
 await save('team',60,0,{...team,first_name:'Synthetic',last_name:'Worker'});
 const row={team_member_id:id(60),team_version:1,location_id:id(2),work_date:'2026-01-02',total_hours:7.5},run=(hash,rows)=>db.query('select hr_import_workdays($1,$2::jsonb) r',[hash,JSON.stringify(rows)]);
 await db.exec('set role authenticated');
 assert.equal((await run('a'.repeat(64),[row])).rows[0].r.imported,1);
 assert.equal((await run('a'.repeat(64),[row])).rows[0].r.alreadyImported,true);
 await assert.rejects(run('b'.repeat(64),[row]),/already exist/);
 await assert.rejects(run('b'.repeat(64),[{...row,work_date:'2026-01-03'},{...row,work_date:'2026-01-04',total_hours:25}]));
 assert.equal((await db.query('select count(*) n from hr_workdays where team_member_id=$1',[id(60)])).rows[0].n,1);
 await assert.rejects(run('b'.repeat(64),[{...row,work_date:'2026-01-03',team_version:2}]),/changed/);
 await assert.rejects(run('b'.repeat(64),[{...row,work_date:'2026-01-03',location_id:id(3)}]));
 await db.exec("set test.role='staff'");await assert.rejects(run('b'.repeat(64),[{...row,work_date:'2026-01-03'}]));await assert.rejects(db.query("select operations_team_directory('purchasing')"));await db.exec("set test.role='owner';set test.mfa='no'");await assert.rejects(run('b'.repeat(64),[row]));await db.exec("set test.mfa='yes'");
 const directory=(await db.query("select operations_team_directory('purchasing') r")).rows[0].r;
 assert.ok(directory.find(t=>t.id===id(60)));assert.ok(directory.every(t=>!('phone'in t)&&!('hourly_rate'in t)&&!('email'in t)));
 await db.exec(`reset role;insert into invoices(id,organization_id,location_id,supplier_id,extraction) values('${id(70)}','${org}','${id(2)}','${id(3)}','{"receiving":{"status":"received","receivedBy":"Historic name","receivedDate":"2026-01-01"}}');`);
 const stamp=(await db.query('select updated_at from invoices where id=$1',[id(70)])).rows[0].updated_at;
 const receiver=(who,version=stamp)=>db.query('select set_invoice_team_receiver($1,$2,$3) r',[id(70),version,who]);
 await db.exec('set role authenticated');await assert.rejects(receiver(id(10)));await assert.rejects(receiver(id(60),'2000-01-01'));
 assert.equal((await receiver(id(60))).rows[0].r.receivedBy,'Synthetic Worker');
 await db.exec('reset role');await db.query("select private.web_operation('production',$1)",[JSON.stringify({id:id(80),locationId:id(2),status:'completed',preparedTeamMemberId:id(60)})]);
 assert.equal((await db.query('select prepared_team_member_name from prep_batches where id=$1',[id(80)])).rows[0].prepared_team_member_name,'Synthetic Worker');
 await assert.rejects(db.query("select private.web_operation('production',$1)",[JSON.stringify({id:id(81),locationId:id(2),status:'completed',preparedTeamMemberId:id(10)})]));
 assert.equal((await db.query('select count(*) n from prep_batches where id=$1',[id(81)])).rows[0].n,0);
 const ps=(await db.query('select prepared_assignment_version from prep_batches where id=$1',[id(80)])).rows[0].prepared_assignment_version;
 await db.query('select set_prep_team_member($1,$2,$3)',[id(80),ps,id(60)]);
 await db.exec("set test.role='staff'");await assert.rejects(db.query('select set_prep_team_member($1,$2,$3)',[id(80),ps,id(60)]));
 console.log('PASS atomic workday imports, retry idempotence, existing-day conflict, version/location/role/MFA checks, minimal directory, invoice and prep team links, rollback and historical name preservation');
}
