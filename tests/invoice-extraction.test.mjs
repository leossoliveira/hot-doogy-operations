import test from 'node:test';import assert from 'node:assert/strict';
import {extractInvoice,validateInvoiceExtraction,invoiceSchema} from '../server/invoice-extraction.mjs';
import {invoiceSuggestions} from '../src/invoice-intake-ui.js';
import {financialStatus} from '../src/invoice-financial.js';
import {invoicePriceHistory} from '../src/invoice-price-history.js';
const sample=()=>Object.fromEntries(Object.keys(invoiceSchema.properties).map(k=>[k,k==='document_complete'?true:k==='document_type'?'invoice':k==='confidence'?'high':['items','warnings'].includes(k)?[]:null]));
test('all document classifications and low confidence remain available for human review',()=>{for(const document_type of ['invoice','receiving_proof','other','uncertain']){const result=validateInvoiceExtraction({...sample(),document_type,confidence:'low'});assert.equal(result.document_type,document_type);assert.equal(result.total,null);assert.deepEqual(result.items,[]);assert.ok(result.warnings.some(w=>/Low confidence/.test(w)));if(document_type!=='invoice')assert.ok(result.warnings.some(w=>/financial nature/.test(w)));}assert.throws(()=>validateInvoiceExtraction({document_type:'invoice'}));});
test('invalid dates remain unresolved and no missing values are invented',()=>{const x=validateInvoiceExtraction({...sample(),invoice_date:'2026-13-02',due_date:'2026-02-30'});assert.equal(x.invoice_date,null);assert.equal(x.due_date,null);assert.equal(x.total,null);});
test('Responses extraction keeps file in request, disables storage and requires structured output',async()=>{let request;const result=await extractInvoice(Buffer.from('%PDF-synthetic'),'application/pdf',{config:{key:'fake',model:'test'},fetcher:async(url,args)=>{request=JSON.parse(args.body);assert.equal(url,'https://api.openai.com/v1/responses');return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(sample())}]}]})};}});assert.equal(request.store,false);assert.equal(request.text.format.strict,true);assert.equal(request.input[0].content[0].type,'input_file');assert.equal(result.extraction.document_type,'invoice');});
test('refusals, truncation and provider failures do not produce a draft',async()=>{for(const response of [{ok:false,status:401},{ok:true,json:async()=>({status:'incomplete'})},{ok:true,json:async()=>({status:'completed',output:[{content:[{type:'refusal'}]}]})}])await assert.rejects(extractInvoice(Buffer.from('test'),'image/png',{config:{key:'fake',model:'test'},fetcher:async()=>response}));});
test('suggestions use exact identities; ambiguous store or order stays unresolved',()=>{const data={suppliers:[{id:'s',name:'US Foods'}],locations:[{id:'l',name:'Natick Mall'}],orders:[{id:'o',number:'123',supplierId:'s',locationId:'l'}]};assert.deepEqual(invoiceSuggestions({supplier_name:'US Foods',location_name:'Natick Mall',order_number:'123'},data),{supplierId:'s',locationId:'l',orderId:'o'});assert.equal(invoiceSuggestions({supplier_name:'US Foods',location_name:'unknown',order_number:'123'},data).orderId,'');data.orders.push({...data.orders[0],id:'o2'});assert.equal(invoiceSuggestions({supplier_name:'US Foods',location_name:'Natick Mall',order_number:'123'},data).orderId,'');});
test('LLM drafts have no payment status or price history before approval',()=>{const draft={intakeSource:'llm',status:'review',total:10,dueDate:'2020-01-01'};assert.equal(financialStatus(draft),'draft');assert.deepEqual(invoicePriceHistory({},[draft],'all',true),[]);assert.equal(financialStatus({...draft,humanApprovedAt:'2026-10-11',status:'approved'},new Date('2026-10-11T12:00:00Z')),'overdue');});

test('incomplete page extraction is rejected',()=>assert.throws(()=>validateInvoiceExtraction({...sample(),document_complete:false}),/incomplete/));
test('catch-weight lines keep purchased cases and printed line totals',()=>{const x=validateInvoiceExtraction({...sample(),subtotal:318.1,tax:0,fees:13,total:331.1,items:[{description:'BEEF, GRND 81/19',sku:'1028447',quantity:1,unit:'CS',unit_price:4.39,line_total:262.52},{description:'CHEESE',sku:null,quantity:1,unit:'CS',unit_price:55.58,line_total:55.58}]});assert.equal(x.items[0].quantity,1);assert.equal(x.items[0].unit_price,262.52);assert.equal(x.items[1].unit_price,55.58);assert.equal(x.warnings.length,1);assert.match(x.warnings[0],/line 1/);});
test('totals that do not add up are flagged without changing printed values',()=>{const x=validateInvoiceExtraction({...sample(),subtotal:100,tax:5,fees:0,total:110,items:[{description:'A',sku:null,quantity:3,unit:'CS',unit_price:30,line_total:90}]});assert.equal(x.total,110);assert.equal(x.subtotal,100);assert.ok(x.warnings.some(w=>/printed subtotal is 100.00/.test(w)));assert.ok(x.warnings.some(w=>/printed total is 110.00/.test(w)));});
test('reconciled totals add no warnings',()=>{const x=validateInvoiceExtraction({...sample(),subtotal:158.61,tax:3.47,fees:13,total:175.08,warnings:['model note'],items:[{description:'MAYO',sku:null,quantity:3,unit:'CS',unit_price:52.87,line_total:158.61}]});assert.deepEqual(x.warnings,['model note']);});

// Synthetic transcription of the supplied receipt; this verifies the provider contract,
// not live model OCR or classification accuracy.
test('both providers accept a purchase receipt draft with weight, rounding and human review',async()=>{
 const {extractOpenClawInvoice}=await import('../server/openclaw-invoice.mjs');
 const receipt={...sample(),supplier_name:"MOM’s Organic Market",invoice_number:'028596-02',invoice_date:'2026-10-18',subtotal:2.10,total:2.10,currency:'USD',items:[{description:'BANANAS OG',sku:null,quantity:2.67,unit:'lb',unit_price:0.79,line_total:2.11},{description:'Cash Change Adjustment',sku:null,quantity:1,unit:null,unit_price:-0.01,line_total:-0.01}],warnings:['Purchase receipt accepted in place of a formal invoice.']};
 for(const provider of [extractInvoice,extractOpenClawInvoice]){
  let request;
  const result=await provider(Buffer.from('synthetic receipt'),'image/jpeg',{config:{key:'fake',model:'test',url:'http://localhost/v1/responses',token:'fake',agent:'invoice-analysis'},fetcher:async(url,args)=>{request=JSON.parse(args.body);return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(receipt)}]}]})};}});
  assert.match(request.instructions,/Accept any invoice, receipt or proof document/);
  assert.match(request.instructions,/US month\/day\/year/);
  assert.match(request.instructions,/visually re-read each printed digit/);
  assert.match(request.instructions,/Do not substitute the upload date, filename date/);
  assert.match(request.instructions,/delivery receipt or receiving proof only acknowledges delivery/);
  assert.match(request.instructions,/never Cash, Total Tendered or Change/);
  assert.match(request.instructions,/Do not create item lines for tendered cash or change/);
  const x=result.extraction;assert.equal(x.document_type,'invoice');assert.equal(x.invoice_number,'028596-02');assert.equal(x.total,2.10);assert.equal(x.items[0].quantity,2.67);assert.equal(x.items[0].unit,'lb');assert.equal(x.items[1].line_total,-0.01);assert.equal(x.due_date,null);assert.equal(x.warnings.length,1);
 }
});

test('both providers return payment proofs, simple receipts and delivery proofs without inventing items',async()=>{
 const {extractOpenClawInvoice}=await import('../server/openclaw-invoice.mjs');
 for(const provider of [extractInvoice,extractOpenClawInvoice])for(const document_type of ['invoice','other','receiving_proof','uncertain']){
  const evidence={...sample(),document_type,confidence:'low',total:document_type==='receiving_proof'?null:75,warnings:['Original document requires review.']};
  const result=await provider(Buffer.from('synthetic proof'),'image/png',{config:{key:'fake',model:'test',url:'http://localhost/v1/responses',token:'fake',agent:'invoice-analysis'},fetcher:async(url,args)=>{
   const request=JSON.parse(args.body);
   assert.match(request.instructions,/non-itemized purchase receipts/);
   assert.match(request.instructions,/payment confirmations, bank transfers, card vouchers/);
   assert.match(request.instructions,/must not create a duplicate expense/);
   assert.match(request.instructions,/never invent item lines from a payment total/);
   return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(evidence)}]}]})};
  }});
  assert.equal(result.extraction.document_type,document_type);
  assert.equal(result.extraction.total,evidence.total);
  assert.equal(result.extraction.invoice_date,null);
  assert.deepEqual(result.extraction.items,[]);
  assert.ok(result.extraction.warnings.some(w=>/Low confidence/.test(w)));
 }
});

test('ship-to street numbers override incorrect model store names without matching only Natick',()=>{
 const data={locations:[{id:'mall',name:'Natick Mall'},{id:'plaza',name:'Sherwood Plaza'}]};
 for(const street of ['1300 Worcester St., D, Natick, MA 01760','1300 WORCESTER STREET Natick Massachusetts 01760'])assert.equal(invoiceSuggestions({location_name:'Natick Mall',ship_to_address:street},data).locationId,'plaza');
 assert.equal(invoiceSuggestions({location_name:'Sherwood Plaza',ship_to_address:'1245 Worcester St, Natick MA 01760'},data).locationId,'mall');
 for(const street of ['Worcester St, Natick MA','999 Worcester St, Natick MA','1300 Worcester St, Boston MA','1300 Worcester St Natick MA / 1245 Worcester St Natick MA'])assert.equal(invoiceSuggestions({location_name:'Natick Mall',ship_to_address:street},data).locationId,'');
 assert.equal(invoiceSuggestions({ship_to_address:'1300 Worcester St Natick MA'},{locations:[data.locations[0]]}).locationId,'');
});
