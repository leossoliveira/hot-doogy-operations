const {PGlite}=await import(process.env.PGLITE_MODULE_PATH||'@electric-sql/pglite');
import fs from 'node:fs';import assert from 'node:assert/strict';
const db=new PGlite(),u=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`,hash='a'.repeat(64);
await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;create schema auth;
create table auth.users(id uuid primary key);insert into auth.users values('${u(1)}');
create type public.invoice_status as enum('uploaded','processing','review','approved','paid','cancelled');create type public.purchase_order_status as enum('draft','ordered','received','cancelled');
create type public.member_role as enum('owner','admin','manager','staff');
create function auth.uid() returns uuid language sql as $$select '${u(1)}'::uuid$$;
create function private.mfa_authorized() returns boolean language sql as $$select current_setting('test.mfa',true)='yes'$$;
create function private.is_org_member(x uuid) returns boolean language sql as $$select x='${u(2)}'::uuid$$;
create function private.can_location(x uuid) returns boolean language sql as $$select x='${u(3)}'::uuid$$;
create function private.can_supplier(x uuid) returns boolean language sql as $$select x='${u(4)}'::uuid$$;
create function private.has_org_role(x uuid,r public.member_role[]) returns boolean language sql as $$select current_setting('test.role',true)=any(r::text[])$$;
create function private.invoice_has_verified_s3(x uuid) returns boolean language sql as $$select current_setting('test.verified',true)='yes'$$;
create table public.locations(id uuid primary key,organization_id uuid);create table public.suppliers(id uuid primary key,organization_id uuid);
create table public.purchase_orders(id uuid primary key default gen_random_uuid(),organization_id uuid,location_id uuid,supplier_id uuid,status public.purchase_order_status,order_number text,ordered_at timestamptz,notes text,estimated_total numeric,created_by uuid,approved_by uuid);
create table public.tags(id uuid primary key default gen_random_uuid(),organization_id uuid,name text,color text);
create table public.purchase_order_tags(purchase_order_id uuid,tag_id uuid,primary key(purchase_order_id,tag_id));
create table public.invoices(id uuid primary key,organization_id uuid,location_id uuid,supplier_id uuid,purchase_order_id uuid,receipt_id uuid,invoice_number text,invoice_date date,due_date date,status public.invoice_status,subtotal numeric,tax numeric,fees numeric,total numeric,currency text,created_by uuid,document_kind text not null check(document_kind='invoice'),notes text,updated_at timestamptz default now());
create table public.invoice_lines(id uuid primary key default gen_random_uuid(),organization_id uuid,invoice_id uuid,supplier_item_id uuid,inventory_item_id uuid,description text,sku text,item_unit_id uuid,quantity numeric,quantity_base numeric,unit_price numeric,line_total numeric);
create table public.supplier_items(id uuid primary key,organization_id uuid,supplier_id uuid,inventory_item_id uuid,sku text);
create table public.units(id uuid primary key,name text,code text);
create table public.inventory_item_units(id uuid primary key,organization_id uuid,inventory_item_id uuid,unit_id uuid,quantity_in_base_unit numeric);
create table public.purchase_order_lines(organization_id uuid,purchase_order_id uuid,supplier_item_id uuid,inventory_item_id uuid,purchase_item_unit_id uuid,ordered_purchase_qty numeric,estimated_unit_price numeric,line_total numeric,notes text);
create table public.audit_logs(organization_id uuid,location_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,new_data jsonb);
create table private.invoice_document_reviews(invoice_id uuid,sha256 text);
create table public.inventory_transactions(id uuid);create table public.purchase_receipts(id uuid);
insert into locations values('${u(3)}','${u(2)}');insert into suppliers values('${u(4)}','${u(2)}');
insert into units values('${u(7)}','Each','ea');insert into inventory_item_units values('${u(8)}','${u(2)}','${u(6)}','${u(7)}',1);
insert into supplier_items values('${u(5)}','${u(2)}','${u(4)}','${u(6)}','SKU1');
set test.role='manager';set test.mfa='yes';set test.verified='no';`);
// Use the actual existing auto-order trigger, omitting its separately tested policies.
const original=fs.readFileSync(new URL('../migrations/20260918113639_create_order_for_unlinked_invoices.sql',import.meta.url),'utf8');
await db.exec(original.slice(original.indexOf('create or replace function private.create_order_from_unlinked_invoice()')));
await db.exec(fs.readFileSync(process.argv[2],'utf8'));
await db.exec('alter table invoices add column payment_date date,add column payment_method text');
await db.exec(fs.readFileSync(new URL('../migrations/20261011172226_editable_invoice_drafts.sql',import.meta.url),'utf8'));
const payload={locationId:u(3),supplierId:u(4),number:'TEST-1',date:'2026-10-11',dueDate:'2026-11-01',total:10,documentKind:'invoice',documentReviewed:true,sourceSha256:hash,extraction:{document_type:'invoice'},items:[{description:'Synthetic item',sku:'SKU1',unit:'Each',quantity:2,unit_price:5,line_total:10}],currency:'USD'};
const save=(id=u(20),p=payload)=>db.query('select save_llm_invoice_draft($1,$2) result',[id,JSON.stringify(p)]);
await assert.rejects(save(u(20),{...payload,documentKind:'receipt'}));await assert.rejects(save(u(20),{...payload,documentReviewed:false}));
await db.exec("set test.role='staff'");await assert.rejects(save());await db.exec("set test.role='manager';set test.mfa='no'");await assert.rejects(save());await db.exec("set test.mfa='yes'");
await assert.rejects(save(u(20),{...payload,locationId:u(90)}));
const result=(await save()).rows[0].result;assert.equal(result.status,'review');
assert.equal((await db.query('select status from purchase_orders')).rows[0].status,'draft');
assert.equal((await db.query('select count(*)::int n from invoice_lines')).rows[0].n,1);
await save();assert.equal((await db.query('select count(*)::int n from invoices')).rows[0].n,1);
await assert.rejects(save(u(21))); // duplicate supplier invoice
await assert.rejects(db.exec(`update invoices set status='paid' where id='${u(20)}'`));
await assert.rejects(db.exec(`update invoices set intake_source=null where id='${u(20)}'`));
await assert.rejects(db.query('insert into private.invoice_document_reviews values($1,$2)',[u(20),'b'.repeat(64)]));
await db.query('insert into private.invoice_document_reviews values($1,$2)',[u(20),hash]);
const edit=(version,fields)=>db.query('select edit_llm_invoice_draft($1,$2,$3) result',[u(20),version,JSON.stringify(fields)]);
await assert.rejects(edit('2000-01-01T00:00:00Z',payload));
const edited=(await edit(result.updatedAt,{...payload,total:15,notes:'Reviewed',items:[{...payload.items[0],quantity:3,line_total:15}]})).rows[0].result;
assert.equal((await db.query('select total from invoices')).rows[0].total,'15');
assert.equal((await db.query('select ordered_purchase_qty from purchase_order_lines')).rows[0].ordered_purchase_qty,'3');
await assert.rejects(edit(result.updatedAt,payload));result.updatedAt=edited.updatedAt;
const approve=(updated=result.updatedAt,status='unpaid')=>db.query('select approve_llm_invoice_draft($1,$2,$3)',[u(20),updated,status]);
await assert.rejects(approve());await db.exec("set test.verified='yes'");await assert.rejects(approve('2000-01-01T00:00:00Z'));await assert.rejects(approve(result.updatedAt,'guess'));
await approve();await assert.rejects(edit(result.updatedAt,payload));assert.equal((await db.query('select status from invoices')).rows[0].status,'approved');assert.equal((await db.query('select status from purchase_orders')).rows[0].status,'ordered');await assert.rejects(approve());
assert.equal((await db.query('select count(*)::int n from inventory_transactions')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from purchase_receipts')).rows[0].n,0);
await assert.rejects(db.exec(`update invoices set total=11 where id='${u(20)}'`));
// An explicit order must have the same supplier and location.
await db.exec(`insert into purchase_orders(id,organization_id,location_id,supplier_id,status) values('${u(30)}','${u(2)}','${u(99)}','${u(4)}','ordered')`);
await assert.rejects(save(u(22),{...payload,number:'TEST-2',orderId:u(30)}));
await db.exec(`update purchase_orders set location_id='${u(3)}' where id='${u(30)}'`);
const linked=(await save(u(22),{...payload,number:'TEST-2',orderId:u(30)})).rows[0].result;assert.equal(linked.orderId,u(30));
await assert.rejects(db.query('select approve_invoice_draft_payment($1,$2,$3,$4,$5)',[u(22),linked.updatedAt,'paid',null,null]));
await db.query('select approve_invoice_draft_payment($1,$2,$3,$4,$5)',[u(22),linked.updatedAt,'paid','2026-10-09','credit_card']);
assert.equal((await db.query(`select payment_method from invoices where id='${u(22)}'`)).rows[0].payment_method,'credit_card');assert.equal((await db.query(`select status from invoices where id='${u(22)}'`)).rows[0].status,'paid');
if(process.argv[3]){
 await db.exec(fs.readFileSync(process.argv[3],'utf8'));
 const fresh=(await save(u(40),{...payload,number:'RECEIVING-TEST',receivingStatus:'received',receivedBy:'Martiese',receivedDate:'2026-10-09',paymentStatus:'paid',paymentDate:'2026-10-09',paymentMethod:'debit_card'})).rows[0].result;
 assert.equal((await db.query(`select extraction from invoices where id='${u(40)}'`)).rows[0].extraction.reviewedFields.receivedBy,'Martiese');
 const review=(status='received',by='Martiese',date='2026-10-09')=>db.query('select approve_invoice_review($1,$2,$3,$4,$5,$6,$7,$8)',[u(40),fresh.updatedAt,'paid','2026-10-09','debit_card',status,by,date]);
 await assert.rejects(review('invalid'));await assert.rejects(review('received',''));await assert.rejects(review('received','Martiese','2999-01-01'));
 await db.exec("set test.role='staff'");await assert.rejects(review());await db.exec("set test.role='manager';set test.mfa='no'");await assert.rejects(review());await db.exec("set test.mfa='yes'");
 assert.equal((await db.query(`select status from invoices where id='${u(40)}'`)).rows[0].status,'review');
 await review();await assert.rejects(review());
 const received=(await db.query(`select extraction,status,payment_method from invoices where id='${u(40)}'`)).rows[0];
 assert.equal(received.extraction.receiving.status,'received');assert.equal(received.extraction.receiving.receivedBy,'Martiese');assert.equal(received.extraction.receiving.receivedDate,'2026-10-09');assert.equal(received.status,'paid');assert.equal(received.payment_method,'debit_card');
 const pending=(await save(u(41),{...payload,number:'NOT-RECEIVED'})).rows[0].result;
 await db.query('select approve_invoice_review($1,$2,$3,$4,$5,$6,$7,$8)',[u(41),pending.updatedAt,'unpaid',null,null,'not_received','stale','2026-10-09']);
 const declaration=(await db.query(`select extraction from invoices where id='${u(41)}'`)).rows[0].extraction.receiving;
 assert.equal(declaration.receivedBy,null);assert.equal(declaration.receivedDate,null);
 assert.equal((await db.query('select count(*)::int n from inventory_transactions')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from purchase_receipts')).rows[0].n,0);
 console.log('PASS: receiving and payment approval, validation, role/MFA, replay rejection, no stock or receipt writes');
}
if(process.argv[4]){
 await db.exec(fs.readFileSync(process.argv[4],'utf8'));
 const typed={...payload,number:'TYPE-TEST',items:[{...payload.items[0],item_type:'prepared'}]};
 const draft=(await save(u(50),typed)).rows[0].result;
 assert.equal((await db.query(`select source_item_type from invoice_lines where invoice_id='${u(50)}'`)).rows[0].source_item_type,'prepared');
 await db.query('select edit_llm_invoice_draft($1,$2,$3)',[u(50),draft.updatedAt,JSON.stringify({...typed,items:[{...typed.items[0],item_type:'purchased'}]})]);
 assert.equal((await db.query(`select source_item_type from invoice_lines where invoice_id='${u(50)}'`)).rows[0].source_item_type,'purchased');
 await assert.rejects(save(u(51),{...typed,number:'INVALID-TYPE',items:[{...typed.items[0],item_type:'invalid'}]}));
 console.log('PASS: invoice item types persist through create/edit and reject invalid types');
}
if(process.argv[5]){
 await db.exec(`create table inventory_categories(id uuid primary key,organization_id uuid);insert into inventory_categories values('${u(70)}','${u(2)}'),('${u(71)}','${u(99)}');`);
 await db.exec(fs.readFileSync(process.argv[5],'utf8'));
 const categorized={...payload,number:'CATEGORY-TEST',items:[{...payload.items[0],category_id:u(70)}]};
 const draft=(await save(u(60),categorized)).rows[0].result;
 assert.equal((await db.query(`select source_category_id from invoice_lines where invoice_id='${u(60)}'`)).rows[0].source_category_id,u(70));
 await assert.rejects(save(u(61),{...categorized,number:'OTHER-CATEGORY',items:[{...categorized.items[0],category_id:u(71)}]}));
 await db.query('select edit_llm_invoice_draft($1,$2,$3)',[u(60),draft.updatedAt,JSON.stringify({...categorized,items:[{...categorized.items[0],category_id:null}]})]);
 assert.equal((await db.query(`select source_category_id from invoice_lines where invoice_id='${u(60)}'`)).rows[0].source_category_id,null);
 console.log('PASS: invoice category create/edit, clearing, cross-tenant rejection');
}
// Regression: the model classification must not veto an authenticated human review.
if(process.argv[6]){
 const proof={...payload,number:'HUMAN-REVIEW',extraction:{document_type:'other',confidence:'low',warnings:['Order confirmation; review financial details.']}};
 await assert.rejects(save(u(80),proof),/A reviewed financial invoice is required/);
 const aclBefore=(await db.query("select proacl::text as acl, prosecdef, proconfig from pg_proc where oid='public.save_llm_invoice_draft(uuid,jsonb)'::regprocedure")).rows;
 await db.exec(fs.readFileSync(process.argv[6],'utf8'));
 assert.deepEqual((await db.query("select proacl::text as acl, prosecdef, proconfig from pg_proc where oid='public.save_llm_invoice_draft(uuid,jsonb)'::regprocedure")).rows,aclBefore);
 for(const [index,document_type] of ['other','receiving_proof','uncertain','invoice'].entries()){
  const id=u(80+index),review={...proof,number:'HUMAN-'+index,extraction:{...proof.extraction,document_type}};
  for(const documentReviewed of [false,null,undefined])await assert.rejects(save(id,{...review,documentReviewed}),/reviewed financial invoice/);
  await assert.rejects(save(id,{...review,documentKind:'receiving_proof'}),/reviewed financial invoice/);
  await db.exec("set test.role='staff'");await assert.rejects(save(id,review),/access denied/);await db.exec("set test.role='manager';set test.mfa='no'");await assert.rejects(save(id,review),/access denied/);await db.exec("set test.mfa='yes'");
  await assert.rejects(save(id,{...review,locationId:u(90)}),/access denied/);
  const saved=(await save(id,review)).rows[0].result;assert.equal(saved.status,'review');
  const row=(await db.query('select extraction, human_approved_at, source_sha256 from invoices where id=$1',[id])).rows[0];
  assert.deepEqual(row.extraction.result,review.extraction);assert.equal(row.extraction.reviewedFields.documentReviewed,true);assert.equal(row.human_approved_at,null);assert.equal(row.source_sha256,hash);
  await save(id,review);await assert.rejects(save(u(90+index),review),/already exists/);
 }
 assert.equal((await db.query('select count(*)::int n from inventory_transactions')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from purchase_receipts')).rows[0].n,0);
 console.log('PASS: reviewed receipts/proofs keep original classification, require human confirmation and retain scope, MFA, duplicate and approval protections');
}
await db.close();console.log('PASS: draft creation, receipt rejection, scope/MFA/roles, duplicate/idempotency, exact SKU/unit mapping, From Invoice draft order, original hash binding, approval/payment gates, stale protection, zero receipt/stock writes.');
