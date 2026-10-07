import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createAuth} from '../../server/auth.mjs';
import {projectData,readTables,TABLES} from '../../server/live-data.mjs';
import {createRefreshLoop} from '../../src/cloud.js';
const response=data=>({ok:true,status:200,json:async()=>data});
function request(body,cookie){return Object.assign(Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]),{headers:{cookie},socket:{remoteAddress:'test'},method:body?'POST':'GET'});}
function res(){return {headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(s,h){this.status=s;Object.assign(this.headers,h);},end(s){this.body=s;}};}
test('live projection retains all entities and count semantics against verified exports',async()=>{
 const {readFile}=await import('node:fs/promises');const raw={};for(const t of TABLES)raw[t]=await readFile(new URL(`../../audits/cloud-integration-2026-10-05/fixtures/${t}.json`,import.meta.url),'utf8').then(JSON.parse).catch(()=>[]);
 const data=projectData(raw);assert.equal(data.orders.length,260);assert.equal(data.supplierCatalog.items.length,166);assert.equal(data.salesPeriods.facts.length,10504);
 const old=JSON.parse(await readFile(new URL('../../public/data/inventory-counts.json',import.meta.url),'utf8'));
 for(const row of data.inventoryCounts.rows){const before=old.rows.find(x=>x.key===row.key);assert.ok(before);if(before.baseQty==null)assert.equal(row.baseQty,null,row.key);else assert.ok(Math.abs(row.baseQty-before.baseQty)<0.00001,row.key);}
 assert.ok(data.recipes.flatMap(r=>r.components).every(c=>c.name&&c.kind&&c.itemUnitId));
});
test('live operations preserve historical receipt evidence and correction movements',async()=>{
 const {readFile}=await import('node:fs/promises');const raw={};for(const t of TABLES)raw[t]=await readFile(new URL(`../../audits/cloud-integration-2026-10-05/fixtures/${t}.json`,import.meta.url),'utf8').then(JSON.parse).catch(()=>[]);
 const data=projectData(raw);
 assert.equal(data.orders.filter(o=>o.receiptEvidence.computedStatus==='confirmed_received').length,218);
 const corrected=data.invoices.find(i=>i.id==='4c5909aa-e204-46a6-8e5c-94edb5466410');assert.equal(corrected.historicalCorrections.length,32);
 for(const t of data.transfers)for(const l of t.lines)assert.equal(l.inTransitQuantity,l.dispatchedQuantity-l.receivedQuantity);
});
