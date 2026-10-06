import test from 'node:test';
import assert from 'node:assert/strict';
import {invoiceCatalogPrice,filterInvoices} from '../src/invoice-model.js';
import {invoiceDownload} from '../server/invoice-download.mjs';
import {ORGANIZATION_ID,SUPABASE_URL} from '../server/supabase-config.mjs';
const invoice={supplierId:'supplier',locationId:'store'};
const catalog={items:[{supplierId:'supplier',supplierItemId:'sku',itemId:'item',units:[{id:'case',itemUnitId:'case-id',factor:12},{id:'each',itemUnitId:'each-id',factor:1}],currentPrices:[{status:'approved',locationId:null,unitId:'case',amount:120},{status:'approved',locationId:'store',unitId:'case',amount:144}]}]};
test('invoice unit price uses the current supplier/location catalog and preserves original amounts',()=>{
 const line={supplierItemId:'sku',itemUnitId:'case-id',unitPrice:50,lineTotal:100};
 assert.equal(invoiceCatalogPrice(line,invoice,catalog),144);
 assert.equal(invoiceCatalogPrice(line,{...invoice,locationId:'other'},catalog),120);
 assert.equal(line.unitPrice,50);assert.equal(line.lineTotal,100);
 assert.equal(invoiceCatalogPrice({...line,itemUnitId:'each-id'},invoice,catalog),12);
});
test('missing or ambiguous catalog links and unit conversions never fabricate prices',()=>{
 assert.equal(invoiceCatalogPrice({supplierItemId:'wrong'},invoice,catalog),null);
 assert.equal(invoiceCatalogPrice({supplierItemId:'sku',itemUnitId:'unknown'},invoice,catalog),null);
 assert.equal(invoiceCatalogPrice({supplierItemId:'sku'}, {...invoice,supplierId:'other'},catalog),null);
 assert.equal(invoiceCatalogPrice({itemId:'item'},invoice,{items:[...catalog.items,...catalog.items]}),null);
 const zero=structuredClone(catalog);zero.items[0].currentPrices[1].amount=0;
 assert.equal(invoiceCatalogPrice({supplierItemId:'sku',itemUnitId:'case-id'},invoice,zero),0);
});
const invoiceId='11111111-1111-4111-8111-111111111111',docId='22222222-2222-4222-8222-222222222222';
const url=new URL(`http://localhost/api/invoices/${invoiceId}/documents/${docId}/download`);
const document={storage_path:`${ORGANIZATION_ID}/${invoiceId}/invoice original.pdf`,file_name:'Invoice #123.pdf',mime_type:'application/pdf'};
const response=()=>({writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}});
test('invoice download checks both records with user RLS and retrieves the private file using the same token',async()=>{
 const calls=[],res=response();let requested;
 const auth={request:async(path,opts)=>{calls.push({path,...opts});return calls.length===1?[{id:invoiceId}]:[document];}};
 await invoiceDownload({method:'GET'},res,url,auth,{token:'user-token'},async(path,opts)=>{requested={path,...opts};return new Response('%PDF-original');});
 assert.equal(res.status,200);assert.equal(res.body.toString(),'%PDF-original');assert.equal(res.headers['Cache-Control'],'private, no-store');
 assert.match(res.headers['Content-Disposition'],/attachment;.*Invoice%20%23123.pdf/);
 assert.ok(calls.every(c=>c.token==='user-token'));
 assert.ok(calls[0].path.includes(`organization_id=eq.${ORGANIZATION_ID}`));
 assert.ok(calls[1].path.includes(`invoice_id=eq.${invoiceId}`));
 assert.equal(requested.headers.Authorization,'Bearer user-token');
 assert.equal(requested.path,`${SUPABASE_URL}/storage/v1/object/authenticated/invoice-documents/${ORGANIZATION_ID}/${invoiceId}/invoice%20original.pdf`);
});
test('inaccessible, mismatched and traversal documents never reach storage',async()=>{
 for(const [visible,doc] of [[false,document],[true,null],[true,{...document,storage_path:'other/file.pdf'}],[true,{...document,storage_path:`${ORGANIZATION_ID}/${invoiceId}/../other.pdf`}]]){
  let n=0;const auth={request:async()=>++n===1?(visible?[{id:invoiceId}]:[]):doc?[doc]:[]};
  await assert.rejects(invoiceDownload({method:'GET'},response(),url,auth,{token:'user-token'},()=>assert.fail('Must not fetch')),(e)=>e.status===404);
 }
});
test('unavailable files and oversized documents fail without returning file content',async()=>{
 for(const [upstream,status] of [[new Response('not found',{status:404}),404],[new Response('denied',{status:403}),404],[new Response('large',{headers:{'content-length':String(51*1024*1024)}}),413]]){
  let n=0;const res=response(),auth={request:async()=>++n===1?[{id:invoiceId}]:[document]};
  await assert.rejects(invoiceDownload({method:'GET'},res,url,auth,{token:'user-token'},async()=>upstream),e=>e.status===status);
  assert.equal(res.status,undefined);
 }
});

test('receiver names are mapped to the matching receipt and survive invoice projection',async()=>{
 const {readTables,projectData}=await import('../server/live-data.mjs');
 const raw=await readTables({request:async(path,opts)=>{
  if(path.startsWith('/rest/v1/rpc/invoice_receipt_receivers')){assert.equal(opts.token,'user-token');assert.deepEqual(opts.body.p_receipt_ids,['receipt']);return [{receipt_id:'receipt',received_by_name:'Receiver Name'}];}
  if(path.startsWith('/rest/v1/purchase_receipts?'))return [{id:'receipt',received_by:'receiver',status:'completed'}];
  if(path.startsWith('/rest/v1/invoices?'))return [{id:invoiceId,receipt_id:'receipt',status:'approved'}];
  return [];
 }},'user-token');
 assert.equal(projectData(raw).invoices[0].receipts[0].receivedByName,'Receiver Name');
});
test('unavailable receiver lookup does not prevent other workspace data from loading',async()=>{
 const {readTables}=await import('../server/live-data.mjs');
 const raw=await readTables({request:async(path)=>{
  if(path.includes('/rpc/'))throw Error('Unavailable');
  return path.startsWith('/rest/v1/purchase_receipts?')?[{id:'receipt',received_by:'receiver'}]:[];
 }},'user-token');
 assert.equal(raw.purchase_receipts[0].received_by,'receiver');
 assert.equal(raw.purchase_receipts[0].received_by_name,undefined);
});

test('invoice filters combine supplier, status, search and inclusive invoice dates',()=>{
 const rows=[
  {number:'1',supplierId:'a',supplierName:'Acme',status:'unpaid',date:'2026-10-01'},
  {number:'2',supplierId:'a',supplierName:'Acme',status:'unpaid',date:'2026-10-02'},
  {number:'3',supplierId:'b',supplierName:'Other',status:'unpaid',date:'2026-10-02'},
  {number:'4',supplierId:'a',supplierName:'Acme',status:'paid',date:'2026-10-02'},
  {number:'5',supplierId:'a',supplierName:'Acme',status:'cancelled',date:'2026-10-03'},
  {number:'6',supplierId:'a',supplierName:'Acme',status:'unpaid',date:null},
 ];
 assert.equal(filterInvoices(rows).length,6);
 assert.deepEqual(filterInvoices(rows,{supplier:'a',status:'unpaid',start:'2026-10-01',end:'2026-10-02',query:'ACME'}).map(x=>x.number),['1','2']);
 assert.deepEqual(filterInvoices(rows,{start:'2026-10-02',end:'2026-10-02'}).map(x=>x.number),['2','3','4']);
 assert.deepEqual(filterInvoices(rows,{status:'unpaid'}).map(x=>x.number),['1','2','3','6']);
 assert.deepEqual(filterInvoices(rows,{status:'paid',supplier:'b'}),[]);
 assert.equal(filterInvoices(rows,{query:'2'})[0].number,'2');
});

test('multiple invoice suppliers and statuses use OR within each filter and AND across filters',()=>{
 const rows=[
  {number:'1',supplierId:'a',supplierName:'Alpha',status:'unpaid',date:'2026-10-01'},
  {number:'2',supplierId:'b',supplierName:'Beta',status:'paid',date:'2026-10-02'},
  {number:'3',supplierId:'c',supplierName:'Gamma',status:'paid',date:'2026-10-02'},
  {number:'4',supplierId:'b',supplierName:'Beta',status:'cancelled',date:'2026-10-02'},
  {number:'5',supplierId:'a',supplierName:'Alpha',status:'overdue',date:'2026-09-30'},
 ];
 const ids=filters=>filterInvoices(rows,filters).map(x=>x.number);
 assert.deepEqual(ids({supplier:['a','b'],status:['unpaid','paid']}),['1','2']);
 assert.deepEqual(ids({supplier:['a','b'],status:['unpaid','paid'],start:'2026-10-01',end:'2026-10-02'}),['1','2']);
 assert.deepEqual(ids({supplier:['a','b'],status:['unpaid','paid'],query:'beta'}),['2']);
 assert.deepEqual(ids({supplier:[]}),[]);
 assert.deepEqual(ids({status:[]}),[]);
 assert.deepEqual(ids({supplier:'all',status:'all'}),['1','2','3','4','5']);
});

import {financialStatus,invoiceHistory} from '../src/invoice-financial.js';
test('financial statuses respect New York due-day boundary and preserve paid, credit, canceled',()=>{
 const i={status:'approved',total:100,dueDate:'2026-10-05'};
 assert.equal(financialStatus(i,new Date('2026-10-06T03:59:59Z')),'unpaid');
 assert.equal(financialStatus(i,new Date('2026-10-06T04:00:00Z')),'overdue');
 assert.equal(financialStatus({...i,status:'paid'}),'paid');
 assert.equal(financialStatus({...i,status:'paid',total:-1}),'credit');
 assert.equal(financialStatus({...i,status:'cancelled',total:-1}),'cancelled');
 assert.equal(financialStatus({status:'review'}),'unpaid');
});
test('invoice history uses order and completed receipts, never invents a payment date',()=>{
 const events=invoiceHistory({status:'paid',createdAt:'invoice-date',updatedAt:'not-payment-date'},{createdAt:'order-date'},[
 {status:'receiving',receivedAt:'pending-date'},{status:'completed',receivedAt:'2026-10-02'},{status:'completed',receivedAt:'2026-10-01'}]);
 assert.deepEqual(events.map(e=>e.text),['Order created','Received','Received','Invoice paid']);
 assert.deepEqual(events.map(e=>e.at),['order-date','2026-10-01','2026-10-02',undefined]);
 assert.equal(invoiceHistory({status:'approved'},null,[]).length,0);
});
