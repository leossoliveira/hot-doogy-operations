import test from 'node:test';import assert from 'node:assert/strict';
import {openClawInvoiceConfig,extractOpenClawInvoice} from '../server/openclaw-invoice.mjs';
const config={url:'http://127.0.0.1:18789/v1/responses',token:'test-secret',agent:'invoice-analysis'};
test('requires explicit configuration and protects gateway credentials',async()=>{
 await assert.rejects(openClawInvoiceConfig({}),/not configured/);
 await assert.rejects(openClawInvoiceConfig({OPENCLAW_INVOICE_URL:'http://example.com',OPENCLAW_INVOICE_TOKEN:'t',OPENCLAW_INVOICE_AGENT:'invoice-analysis'}),/Invalid/);
});
test('sends inline document to fixed agent without shared session or tools',async()=>{
 let call;await assert.rejects(extractOpenClawInvoice(Buffer.from('test'),'application/pdf',{config,fetcher:async(url,options)=>{call={url,...options};return {ok:true,json:async()=>({status:'incomplete'})};}}),/incomplete/);
 const body=JSON.parse(call.body);assert.equal(body.input[0].type,'message');assert.equal(body.model,'openclaw/invoice-analysis');assert.equal(body.tool_choice,'none');assert.equal(body.user,undefined);assert.equal(body.previous_response_id,undefined);assert.equal(call.redirect,'error');assert.equal(body.input[0].content[1].source.type,'base64');
});
test('fails closed on invalid JSON, tool calls, receiving proof and oversized documents',async()=>{
 for(const result of [{status:'completed',output:[{type:'function_call'}]},{status:'completed',output:[]},{status:'completed',output:[{content:[{type:'output_text',text:'{"document_type":"receiving_proof"}'}]}]}])await assert.rejects(extractOpenClawInvoice(Buffer.from('test'),'application/pdf',{config,fetcher:async()=>({ok:true,json:async()=>result})}));
 await assert.rejects(extractOpenClawInvoice(Buffer.alloc(6*1024*1024),'application/pdf',{config,fetcher:()=>assert.fail('No network')}),/5 MB/);
});
