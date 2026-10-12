import fs from 'node:fs';import assert from 'node:assert/strict';
export async function verifyReceiptTeam(db,{org,id,path}){
 await db.exec(`reset role;set test.role='owner';alter table auth.users add column raw_user_meta_data jsonb;
 create table purchase_orders(id uuid primary key,location_id uuid,supplier_id uuid);
 insert into purchase_orders values('${id(90)}','${id(2)}','${id(3)}');
 create table purchase_receipts(id uuid primary key,organization_id uuid,location_id uuid,supplier_id uuid,purchase_order_id uuid,received_at timestamptz,received_by uuid,status text default 'draft',receiver_name text);
 create or replace function private.web_operation(p_action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
 #variable_conflict use_variable
 declare id uuid:=(p->>'id')::uuid;org uuid:='${org}';actor uuid:=auth.uid();old_order public.purchase_orders;
 begin select * into old_order from public.purchase_orders where purchase_orders.id=(p->>'orderId')::uuid;
 insert into public.purchase_receipts(id,organization_id,location_id,supplier_id,purchase_order_id,received_at,received_by) values(id,org,old_order.location_id,old_order.supplier_id,old_order.id,(p->>'receivedAt')::timestamptz,actor);
 update public.purchase_receipts set status='completed' where purchase_receipts.id=id;return '{}';end $$;`);
 await db.exec(fs.readFileSync(path,'utf8'));
 await db.exec('create trigger purchase_receipts_capture_receiver before insert or update on purchase_receipts for each row execute function private.capture_receipt_receiver()');
 const run=(n,person)=>db.query("select private.web_operation('receipt',$1)",[JSON.stringify({id:id(n),orderId:id(90),receivedAt:'2026-01-01T12:00:00Z',receiverTeamMemberId:person})]);
 await run(91,id(60));const receipt=(await db.query('select * from purchase_receipts where id=$1',[id(91)])).rows[0];
 assert.equal(receipt.receiver_team_member_id,id(60));assert.equal(receipt.receiver_name,'Synthetic Worker');assert.equal(receipt.received_by,id(1));
 await assert.rejects(run(92,id(10)),/active team member/);assert.equal((await db.query('select count(*) n from purchase_receipts where id=$1',[id(92)])).rows[0].n,0);
 await db.query('update purchase_receipts set receiver_team_member_id=$1,receiver_name=$2 where id=$3',[id(10),'Different',id(91)]);
 assert.equal((await db.query('select receiver_name from purchase_receipts where id=$1',[id(91)])).rows[0].receiver_name,'Synthetic Worker');
 console.log('PASS receipt team selection, authenticated recorder preserved, inactive receiver rejection, immutable completed receiver and transactional rollback');
}
