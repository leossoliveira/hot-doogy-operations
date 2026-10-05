import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {readPages} from '../server/paginated-read.mjs';
import {compactFact} from '../server/live-data.mjs';
import {replyData} from '../server/compressed-json.mjs';
test('history pages load concurrently but preserve order and stop at the final partial page',async()=>{
 let active=0,peak=0;const offsets=[];
 const result=await readPages(async url=>{const offset=Number(new URL('https://test.invalid'+url).searchParams.get('offset'));offsets.push(offset);active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,offset===4?1:5));active--;return Array.from({length:Math.max(0,Math.min(2,7-offset))},(_,i)=>offset+i);},'/rows?order=id',{pageSize:2,concurrency:3});
 assert.deepEqual(result,[0,1,2,3,4,5,6]);assert.equal(peak,3);assert.equal(new Set(offsets).size,offsets.length);
});
test('sales payload keeps quantities, money, timestamps and calculation references without raw import dimensions',()=>{
 const fact={id:'fact',quantity:0,refunds:null,net_sales:-3.5,fact_date:'2026-10-05',period_start:'2026-10-05T14:15:00Z',source_row_id:'row',dimensions:{unused:'large source payload'}};
 assert.deepEqual(compactFact(fact),{id:'fact',source_row_id:'row',fact_date:'2026-10-05',period_start:'2026-10-05T14:15:00Z',quantity:0,net_sales:-3.5,refunds:null});
});
test('workspace compression is negotiated and preserves the full data with no-store caching',async()=>{
 const value={name:'Operação',rows:Array.from({length:1000},(_,id)=>({id,name:'HOT DOOGY'}))};let headers,body;const res={writeHead(status,h){assert.equal(status,200);headers=h;},end(b){body=b;}};
 await replyData({headers:{'accept-encoding':'gzip, deflate'}},res,value);assert.equal(headers['Content-Encoding'],'gzip');assert.equal(headers['Cache-Control'],'no-store');assert.deepEqual(JSON.parse(gunzipSync(body)),value);assert.ok(body.length<JSON.stringify(value).length/3);
 await replyData({headers:{'accept-encoding':'gzip;q=0'}},res,value);assert.equal(headers['Content-Encoding'],undefined);assert.deepEqual(JSON.parse(body),value);
});
