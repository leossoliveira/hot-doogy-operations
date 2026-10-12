import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createInvoiceAnalysisJobs} from '../server/invoice-analysis-jobs.mjs';
import {createInvoiceIntake} from '../server/invoice-intake.mjs';
import {Readable} from 'node:stream';
const config=async()=>({}),result={extraction:{invoice_number:'TEST',items:[],supplier_name:'Test Foods'},model:'test'};
test('analysis is acknowledged before completion and persists editable draft across restart',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'invoice-jobs-'));let release;const deferred=new Promise(r=>release=r);
 try{const jobs=createInvoiceAnalysisJobs({directory,config,extract:()=>deferred});const j=await jobs.create({user:'u',bytes:Buffer.from('test'),mime:'application/pdf',fileName:'test.pdf'});assert.equal(j.status,'processing');await assert.rejects(jobs.get(j.id,'other'),/not found/);await assert.rejects(jobs.create({user:'u',bytes:Buffer.from('test'),mime:'application/pdf'}),/already/);release(result);await jobs.idle();assert.equal((await jobs.list('u'))[0].status,'draft');const fields={number:'EDITED',items:[{description:'Edited item'}]};await jobs.update(j.id,'u',fields);const restarted=createInvoiceAnalysisJobs({directory,config,extract:async()=>assert.fail('Completed drafts must not be reprocessed')});assert.deepEqual((await restarted.get(j.id,'u')).fields,fields);assert.equal((await restarted.source(j.id,'u')).bytes.toString(),'test');await restarted.remove(j.id,'u');assert.deepEqual(await restarted.list('u'),[]);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('failed analysis remains visible and removes rejected original bytes',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'invoice-jobs-'));try{const jobs=createInvoiceAnalysisJobs({directory,config,extract:async()=>{throw Object.assign(Error('Not an invoice'),{status:422});}});const j=await jobs.create({user:'u',bytes:Buffer.from('receipt'),mime:'application/pdf'});await jobs.idle();assert.equal((await jobs.list('u'))[0].status,'failed');assert.equal((await jobs.list('u'))[0].error,'Not an invoice');assert.equal((await readdir(directory)).some(x=>x.endsWith('.bin')),false);}finally{await rm(directory,{recursive:true,force:true});}
});
test('HTTP intake returns 202 while extraction continues, without saving/approving a business invoice',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'invoice-jobs-'));let release;const promise=new Promise(r=>release=r);
 try{const intake=createInvoiceIntake({jobsDirectory:directory,config,extract:()=>promise});const req=Readable.from([Buffer.from('synthetic')]);req.method='POST';req.headers={'content-type':'application/pdf','x-file-name':'test.pdf'};let response;const res={writeHead(status){this.status=status;},end(body){response={status:this.status,body:JSON.parse(body)};}};await intake(req,res,new URL('http://localhost/api/invoices/analyze'),{request:()=>assert.fail('No automatic database mutation')},{user:{id:'u'},member:{role:'manager'}});assert.equal(response.status,202);assert.equal(response.body.status,'processing');release(result);for(let i=0;i<50;i++){const j=JSON.parse(await readFile(path.join(directory,response.body.id+'.json'),'utf8'));if(j.status==='draft')break;await new Promise(r=>setTimeout(r,5));}assert.equal(JSON.parse(await readFile(path.join(directory,response.body.id+'.json'),'utf8')).status,'draft');
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('pending analysis drafts join the invoice list and clear when the user changes',async()=>{
 const {createInvoiceIntakeUI}=await import('../src/invoice-intake-ui.js');const original=globalThis.fetch;let owner='one',visible=true,updated;const changed=new Promise(r=>updated=r);
 globalThis.fetch=async()=>({ok:true,json:async()=>[{id:'job',status:'draft',fileName:'original.pdf',number:'DRAFT-1',supplierName:'Test Foods',locationName:'Store',total:12}]});
 try{const ui=createInvoiceIntakeUI({data:()=>({suppliers:[{id:'s',name:'Test Foods'}],locations:[{id:'l',name:'Store'}]}),user:()=>owner,isVisible:()=>visible,onDraftsChange:updated});assert.deepEqual(ui.drafts(),[]);await changed;visible=false;const [row]=ui.drafts();assert.equal(row.number,'DRAFT-1');assert.equal(row.status,'review');assert.equal(row.supplierId,'s');assert.equal(row.locationId,'l');assert.equal(row.analysisJob,true);owner='two';assert.deepEqual(ui.drafts(),[]);}finally{globalThis.fetch=original;}
});
test('approval sends receiving and payment together through authenticated review RPC',async()=>{
 const intake=createInvoiceIntake({config}),body={confirmed:true,expectedUpdatedAt:'version',paymentStatus:'paid',paymentDate:'2026-10-09',paymentMethod:'credit_card',receivingStatus:'received',receivedBy:'00000000-0000-4000-8000-000000000002',receivedDate:'2026-10-09'};
 const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.method='POST';let call;
 await intake(req,{writeHead(){},end(){}},new URL('http://localhost/api/invoices/00000000-0000-4000-8000-000000000001/approve-draft'),{request:async(path,args)=>{call={path,...args};return {ok:true}}},{token:'test-token',user:{id:'u'},member:{role:'manager'}});
 assert.equal(call.path,'/rest/v1/rpc/approve_invoice_team_review');assert.equal(call.token,'test-token');assert.equal(call.body.p_team,'00000000-0000-4000-8000-000000000002');assert.equal(call.body.p_receiving_status,'received');assert.equal(call.body.p_received_date,'2026-10-09');assert.equal(call.body.p_payment_method,'credit_card');
});
