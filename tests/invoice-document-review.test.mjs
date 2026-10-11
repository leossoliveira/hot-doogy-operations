import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';import {createHash} from 'node:crypto';import {invoiceUpload} from '../server/invoice-api.mjs';
const url=new URL('http://localhost/api/invoices/00000000-0000-0000-0000-000000000001/document');
test('receipt and unclassified uploads stop before reading the file or calling storage/database',async()=>{
 for(const headers of [{},{'x-document-kind':'receipt','x-document-reviewed':'true'},{'x-document-kind':'invoice','x-document-reviewed':'false'}]){
  const req=Readable.from([Buffer.from('proof')]);req.method='PUT';req.headers=headers;
  await assert.rejects(invoiceUpload(req,{},url,{request(){throw Error('Database must not be called');}},{}),e=>e.status===422);
  assert.equal(req.readableDidRead,false);
 }
});
test('the server requires a review of the actual bytes before storage is loaded or written',async()=>{
 const body=Buffer.from('%PDF-test'),calls=[],req=Readable.from([body]);req.method='PUT';req.headers={'x-document-kind':'invoice','x-document-reviewed':'true','content-type':'application/pdf'};
 await assert.rejects(invoiceUpload(req,{},url,{async request(path,args){calls.push({path,args});if(path.endsWith('review_invoice_document'))throw Error('Review rejected');return 'canonical.pdf';}},{token:'test'}),/Review rejected/);
 assert.equal(calls.length,2);assert.equal(calls[1].args.body.p_sha256,createHash('sha256').update(body).digest('hex'));assert.equal(calls[1].args.body.p_size,body.length);
});
