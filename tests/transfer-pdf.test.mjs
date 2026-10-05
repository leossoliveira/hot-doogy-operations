import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTransferPdf,transferPrintLines,transferFilename} from '../src/transfer-pdf.js';
import {PDFDocument} from '../src/vendor/pdf-lib.esm.min.js';

test('transfer print uses requested quantities and snapshots, preserving zero and missing values',()=>{
  const x={id:'a/b',lines:[{requestedQuantity:0,approvedQuantity:8,quantity:9,uomName:'Bag',uom:'bag',internalNameSnapshot:'Original item',name:'Current name'},{qty:2,name:'Local draft'},{name:'Missing quantity'}]};
  const before=structuredClone(x),rows=transferPrintLines(x);
  assert.deepEqual(rows[0],['','0.00','Bag','Original item','']);
  assert.equal(rows[1][1],'2.00');assert.equal(rows[2][1],'Not provided');
  assert.deepEqual(x,before);assert.equal(transferFilename(x),'Hot-Doogy-Transfer-A-B.pdf');
});
test('real transfer PDF contains every row without changing the order',async()=>{
  const x=JSON.parse(await readFile(new URL('../public/data/operations-detail.json',import.meta.url))).transfers[0];
  const before=structuredClone(x);
  const bytes=await createTransferPdf(x,{logoBytes:await readFile(new URL('../public/brand/hot-doogy-print.png',import.meta.url))});
  const pdf=await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(),2);for(const page of pdf.getPages()){assert.equal(page.getWidth(),612);assert.equal(page.getHeight(),792);}assert.equal(pdf.getAuthor(),'Hot Doogy');assert.deepEqual(x,before);
});
test('long notes and descriptions paginate without losing rows or hanging',async()=>{
  const x={id:'long',notes:'Long note with accents: Açaí.\n'.repeat(100),lines:Array.from({length:80},(_,i)=>({name:`Item ${i} `+'Long description '.repeat(15),qty:i,uom:'Container'}))};
  const bytes=await createTransferPdf(x,{logoBytes:await readFile(new URL('../public/brand/hot-doogy-print.png',import.meta.url))});
  const pdf=await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount()>3);
});
