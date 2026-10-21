import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createPreparationDatabase,id,org,plaza,mall} from './helpers/preparation-db.mjs';
const db=await createPreparationDatabase();
const group='120363380724268297@g.us';let sequence=100;
const production=()=>({groupId:group,messageId:'PREPTEST'+sequence++,kind:'production',data:{itemId:id(20),itemUnitId:id(30),qty:3,recipeVersionId:id(41),areaId:id(10),preparedTeamMemberId:id(2),notes:'Synthetic production'}});
// Real adapter verifies an isolated native transcript and derives the trusted metadata.
const prepare=p=>JSON.parse(execFileSync('python3',['-B','tests/backup/test_whatsapp_preparation.py','--prepare',JSON.stringify(p)],{encoding:'utf8'}));
const save=p=>db.query('select doogy_operations.record_whatsapp_preparation($1::jsonb) result',[JSON.stringify(p)]).then(r=>r.rows[0].result);
const counts=()=>db.query(`select (select count(*)::int from prep_batches) batches,(select count(*)::int from prep_batch_components) components,(select count(*)::int from inventory_transactions) movements,(select count(*)::int from doogy_operations.preparation_commands) commands,(select count(*)::int from audit_logs) audits`).then(r=>r.rows[0]);
const good=prepare(production());
for(const role of ['anon','authenticated','service_role']){
 await db.exec(`set role ${role}`);await assert.rejects(save(good),/permission/);await db.exec('reset role');
}
await db.exec('set role doogy_prep_service');
for(const q of ['select * from prep_batches',`insert into prep_batches(id) values('${id(90)}')`,'select * from doogy_operations.preparation_commands',`select private.complete_preparation('{}',null)`,`select private.prep_internal_request_command('${id(90)}','create','{}')`])await assert.rejects(db.query(q),/permission/);
const catalog=(await db.query('select doogy_operations.preparation_catalog() c')).rows[0].c;
assert.equal(catalog.recipes.length,1);assert.equal(catalog.items.length,3);assert.equal(catalog.team[0].name,'Synthetic Cook');
await db.exec('reset role');const initial=await counts();
const invalid=[{...good,agentId:'main'},{...good,groupId:'120363311370740378@g.us'},{...good,sourceSha256:'fake'},{...good,data:{...good.data,locationId:mall}},{...good,data:{...good.data,qty:0}},{...good,data:{...good.data,qty:'NaN'}},{...good,data:{...good.data,qty:0.00000001}},{...good,data:{...good.data,itemUnitId:id(31)}},{...good,data:{...good.data,preparedTeamMemberId:id(99)}},{...good,data:{...good.data,areaId:id(12)}}];
await db.exec('set role doogy_prep_service');for(const p of invalid)await assert.rejects(save(p));await db.exec('reset role');assert.deepEqual(await counts(),initial);
// Errors after the first ingredient was inserted roll the batch and earlier writes back.
for(const [change,undo,pattern] of [
 [`update recipe_components set component_item_unit_id='${id(31)}' where id='${id(43)}'`,`update recipe_components set component_item_unit_id='${id(32)}' where id='${id(43)}'`,/component/],
 [`update location_inventory_items set default_storage_area_id=null where inventory_item_id='${id(22)}' and location_id='${plaza}';insert into inventory_item_storage_areas values('${id(22)}','${plaza}','${id(11)}')`,`update location_inventory_items set default_storage_area_id='${id(10)}' where inventory_item_id='${id(22)}' and location_id='${plaza}';delete from inventory_item_storage_areas where inventory_item_id='${id(22)}' and storage_area_id='${id(11)}'`,/ambiguous/],
 [`update recipe_versions set status='archived' where id='${id(41)}'`,`update recipe_versions set status='active' where id='${id(41)}'`,/active/],
 [`update recipe_components set location_id='${mall}'`,`update recipe_components set location_id=null`,/no components/],
 [`update inventory_transactions set quantity_base=0 where inventory_item_id='${id(22)}'`,`update inventory_transactions set quantity_base=10000 where inventory_item_id='${id(22)}'`,/Insufficient/],
 ]){
 await db.exec(change);await db.exec('set role doogy_prep_service');await assert.rejects(save(prepare(production())),pattern);await db.exec('reset role');assert.deepEqual(await counts(),initial);await db.exec(undo);
}
await db.exec(`create function fail_second_ingredient() returns trigger language plpgsql as $$begin if new.transaction_type='prep_consumption' and new.inventory_item_id='${id(22)}' then raise exception 'Synthetic late failure';end if;return new;end$$;create trigger injected_failure before insert on inventory_transactions for each row execute function fail_second_ingredient();set role doogy_prep_service;`);
await assert.rejects(save(prepare(production())),/Synthetic late failure/);await db.exec('reset role;drop trigger injected_failure on inventory_transactions');assert.deepEqual(await counts(),initial);
await db.exec('set role doogy_prep_service;begin');await save(good);await db.exec('rollback;reset role');assert.deepEqual(await counts(),initial);
await db.exec('set role doogy_prep_service');const first=await save(good);assert.deepEqual(await save(good),first);
await assert.rejects(save({...good,data:{...good.data,qty:4}}),/different payload/);
assert.equal(first.quantityBase,30);assert.deepEqual(first.components.map(c=>c.quantityBase),[15,4.5]);assert.deepEqual(first.movements.map(m=>m.quantityBase),[-15,-4.5,30]);
await db.exec('reset role');assert.deepEqual(await counts(),{batches:1,components:2,movements:5,commands:1,audits:2});
assert.equal((await db.query('select prepared_team_member_name from prep_batches where id=$1',[first.id])).rows[0].prepared_team_member_name,'Synthetic Cook');
// A partial historical batch cannot be "fixed" by repeating a new completion.
await db.exec(`insert into prep_batches(id,organization_id,location_id,recipe_version_id,output_inventory_item_id,output_storage_area_id,status,actual_output_base) values('${id(77)}','${org}','${plaza}','${id(41)}','${id(20)}','${id(10)}','completed',30)`);
const human={...good.data,id:id(77),locationId:plaza,status:'completed',completedAt:'2026-01-01T12:00:00Z'};
await db.query('insert into private.web_commands(command_id,actor,payload,result) values($1,$2,$3,$4)',[id(86),id(1),JSON.stringify({actor:id(1),action:'batch',payload:{changes:[{action:'production',payload:human}]}}),JSON.stringify([{id:id(77),saved:true}])]);
const humanSave=(command,p)=>db.query("select operations_command($1,'batch',$2::jsonb) result",[command,JSON.stringify({changes:[{action:'production',payload:p}]})]).then(r=>r.rows[0].result);
await db.exec(`set test.uid='${id(1)}';set test.mfa='yes';set role authenticated`);
await assert.rejects(humanSave(id(80),human),/already completed/);
await assert.rejects(humanSave(id(86),human),/no longer matches/);
const planned={...human,id:id(78),status:'planned',qty:2};delete planned.actualQty;
await humanSave(id(81),planned);
const completed={...planned,status:'completed',actualQty:1};const humanResult=await humanSave(id(82),completed);
assert.equal(humanResult[0].quantityBase,10);assert.deepEqual(await humanSave(id(82),completed),humanResult);
// A new request key for the same exact batch must not consume twice either.
assert.deepEqual(await humanSave(id(83),completed),humanResult);
await assert.rejects(humanSave(id(84),{...completed,actualQty:2}),/different payload/);
await db.exec("set test.mfa='no'");await assert.rejects(humanSave(id(85),{...completed,id:id(79)}),/two-step/);
await db.exec("set test.mfa='yes';set test.role='staff'");await assert.rejects(humanSave(id(85),{...completed,id:id(79)}),/permiss/);
await db.exec("reset role;set test.uid='';set test.role='owner'");
// Complete transfer lifecycle, real state machine, same source deduplication as production.
const transfer=(step,data)=>prepare({groupId:group,messageId:'TRANSFERTEST'+sequence++,kind:'transfer',step,data});
const create=(from,to,qty=2)=>transfer('create',{requesting_location_id:to,fulfilling_location_id:from,needed_on:'2026-01-01',lines:[{inventory_item_id:id(20),item_unit_id:id(30),quantity:qty}]});
await db.exec('set role doogy_prep_service');
await assert.rejects(save(create(plaza,id(99))),/scope|stores/);
await assert.rejects(save(transfer('create',{...create(plaza,mall).data,lines:[{inventory_item_id:id(23),item_unit_id:id(33),quantity:1}]})),/scope/);
const creation=create(plaza,mall);const request=await save(creation);assert.deepEqual(await save(creation),request);
const requestId=request.request_id,lineId=request.lines[0].id;
await db.exec('reset role');const beforeFailedDispatch=await counts();await db.exec('set role doogy_prep_service');
await assert.rejects(save(transfer('dispatch',{request_id:requestId,lines:[{request_line_id:lineId,from_storage_area_id:id(10),quantity:2}]})),/dispatchable/);
await db.exec('reset role');assert.deepEqual(await counts(),beforeFailedDispatch);await db.exec('set role doogy_prep_service');
const approval=transfer('approve',{request_id:requestId,lines:[{request_line_id:lineId,quantity:2}]});await save(approval);await save(approval);
const dispatchPayload=transfer('dispatch',{request_id:requestId,lines:[{request_line_id:lineId,from_storage_area_id:id(10),quantity:2}]});
const dispatched=await save(dispatchPayload);assert.deepEqual(await save(dispatchPayload),dispatched);assert.equal(dispatched.movements[0].quantityBase,-20);
await assert.rejects(save({...dispatchPayload,messageId:'ANOTHERDISPATCH'}),/exceeds/);
await assert.rejects(save({...dispatchPayload,data:{...dispatchPayload.data,notes:'changed'}}),/different payload/);
const transferLine=dispatched.movements[0].sourceId;
const receiptPayload=transfer('receive',{request_id:requestId,transfer_id:dispatched.document_id,lines:[{transfer_line_id:transferLine,to_storage_area_id:id(12),quantity:1}]});
const received=await save(receiptPayload);assert.equal(received.movements[0].quantityBase,10);assert.equal(received.status,'in_progress');assert.deepEqual(await save(receiptPayload),received);
await assert.rejects(save(transfer('receive',{...receiptPayload.data,lines:[{...receiptPayload.data.lines[0],quantity:2}]})),/exceeds/);
await assert.rejects(save(transfer('receive',{...receiptPayload.data,lines:[{...receiptPayload.data.lines[0],to_storage_area_id:id(10)}]})),/destination/);
const end=await save(transfer('receive',receiptPayload.data));assert.equal(end.status,'completed');
assert.deepEqual(await save(dispatchPayload),dispatched); // retry after request advances is safe
// Opposite route uses the real stock just received at Natick.
const reverse=await save(create(mall,plaza,1));const reverseLine=reverse.lines[0].id;
await save(transfer('approve',{request_id:reverse.request_id,lines:[{request_line_id:reverseLine,quantity:1}]}));
const backPayload=transfer('dispatch',{request_id:reverse.request_id,lines:[{request_line_id:reverseLine,from_storage_area_id:id(12),quantity:1}]});const back=await save(backPayload);
const backReceipt=await save(transfer('receive',{request_id:reverse.request_id,transfer_id:back.document_id,lines:[{transfer_line_id:back.movements[0].sourceId,to_storage_area_id:id(10),quantity:1}]}));assert.equal(backReceipt.status,'completed');
await db.exec('reset role');
assert.equal((await db.query("select sum(quantity_base) total from inventory_transactions where inventory_item_id=$1 and transaction_type in ('transfer_in','transfer_out')",[id(20)])).rows[0].total,'0.000000');
// A multi-line dispatch can fail after its first debit; all documents, debits and
// the source key must roll back. The same original message can then be retried.
await db.exec('set role doogy_prep_service');
const multi=await save(transfer('create',{requesting_location_id:mall,fulfilling_location_id:plaza,needed_on:'2026-01-01',lines:[{inventory_item_id:id(20),item_unit_id:id(30),quantity:1},{inventory_item_id:id(22),item_unit_id:id(32),quantity:1}]}));
await save(transfer('approve',{request_id:multi.request_id,lines:multi.lines.map(l=>({request_line_id:l.id,quantity:1}))}));
const multiPayload=transfer('dispatch',{request_id:multi.request_id,lines:multi.lines.map(l=>({request_line_id:l.id,from_storage_area_id:id(10),quantity:1}))});
await db.exec('reset role');
await db.exec(`create function fail_second_dispatch() returns trigger language plpgsql as $$begin if new.transaction_type='transfer_out' and new.inventory_item_id='${multi.lines[1].inventory_item_id}' then raise exception 'Synthetic late dispatch failure';end if;return new;end$$;create trigger injected_dispatch_failure before insert on inventory_transactions for each row execute function fail_second_dispatch();`);
const beforeMulti=await counts(),beforeShipments=(await db.query('select count(*)::int n from interstore_transfers')).rows[0].n;
await db.exec('set role doogy_prep_service');await assert.rejects(save(multiPayload),/late dispatch failure/);await db.exec('reset role');
assert.deepEqual(await counts(),beforeMulti);assert.equal((await db.query('select count(*)::int n from interstore_transfers')).rows[0].n,beforeShipments);
await db.exec('drop trigger injected_dispatch_failure on inventory_transactions;set role doogy_prep_service');
const retriedMulti=await save(multiPayload);assert.equal(retriedMulti.movements.length,2);assert.deepEqual(await save(multiPayload),retriedMulti);await db.exec('reset role');
// Deletion/tampering cannot turn a durable key into a false positive confirmation.
await db.query('update inventory_transactions set quantity_base=quantity_base-1 where id=$1',[first.movements[0].id]);await db.exec('set role doogy_prep_service');await assert.rejects(save(good),/movement changed/);await db.exec('reset role');
await db.query('update inventory_transactions set quantity_base=quantity_base-1 where id=$1',[humanResult[0].movements[0].id]);await db.exec(`set test.uid='${id(1)}';set test.mfa='yes';set role authenticated`);await assert.rejects(humanSave(id(82),completed),/movement changed/);await db.exec("reset role;set test.uid=''");
await db.query('delete from inventory_transactions where id=$1',[back.movements[0].id]);await db.exec('set role doogy_prep_service');await assert.rejects(save(backPayload),/movement count changed/);
const stats=await db.query("select count(*)::int as restricted_functions from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='doogy_operations' and has_function_privilege('doogy_prep_service',p.oid,'execute')");assert.equal(stats.rows[0].restricted_functions,2);
await db.exec('reset role');
assert.equal((await db.query("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='doogy_operations' or (n.nspname='private' and p.proname in ('complete_preparation','verify_preparation','verify_preparation_transfer','prep_transfer_scope','prep_internal_request_command'))) and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute'))")).rows[0].n,0);
await db.close();console.log('PASS isolated preparation: native source → adapter → restricted SQL → atomic production/ingredients → verified retry; human MFA/planned completion; both transfer routes, partial receipt, rollback, scope and duplicate prevention.');
