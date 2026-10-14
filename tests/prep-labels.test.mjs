import test from 'node:test';
import assert from 'node:assert/strict';
import {batchCode,batchNumber,labelCount,labelRows,labelFilename,formatMoment,useByMoment,createPrepLabelsPdf} from '../src/prep-labels.js';
import {PDFDocument} from '../src/vendor/pdf-lib.esm.min.js';

const batch={id:'0f3a9c1e-5b2d-4e8f-9a7b-123456789abc',name:'Chili con carne — house recipe for hot dogs',qty:6,actualQty:6,uom:'Quart container',locationName:'Sherwood Plaza',completedAt:'2026-10-13T22:30:00Z',preparedTeamMemberName:'Ana Souza'};

test('batch number and code derive from the id and the New York completion date',()=>{
  const code=batchCode(batch);
  assert.equal(code.digits.length,11);
  assert.equal(code.digits.slice(0,6),'261013');
  assert.equal(code.number,`BATCH-261013-${code.digits.slice(6)}`);
  assert.equal(batchNumber(batch),code.number);
  assert.equal(batchNumber({...batch,number:'KEEP'}),'KEEP');
  assert.equal(batchCode({...batch,completedAt:'2026-10-14T03:30:00Z'}).digits.slice(0,6),'261013','late evening in New York stays on the same day');
  assert.notEqual(batchCode({...batch,id:'1f3a9c1e-5b2d-4e8f-9a7b-123456789abc'}).digits,code.digits);
  assert.throws(()=>batchCode({id:'x'}));
});
test('label count follows the produced quantity, rounded up and capped',()=>{
  assert.equal(labelCount(6),6);assert.equal(labelCount(2.2),3);assert.equal(labelCount(0),1);assert.equal(labelCount('abc'),1);assert.equal(labelCount(10000),500);
});
test('each label gets a unique 14-digit code with the unit serial',()=>{
  const rows=labelRows(batch);
  assert.equal(rows.length,6);
  assert.equal(new Set(rows.map(r=>r.code)).size,6);
  assert.equal(new Set(rows.map(r=>r.number)).size,6);
  rows.forEach((r,i)=>{assert.equal(r.number,`${batchNumber(batch)}-${String(i+1).padStart(3,'0')}`);assert.equal(r.batchNumber,batchNumber(batch));assert.match(r.code,/^\d{14}$/);assert.equal(r.code.slice(-3),String(i+1).padStart(3,'0'));assert.equal(r.serial,i+1);assert.equal(r.total,6);});
  assert.equal(labelRows(batch,2).length,2);
  assert.equal(labelFilename(batch),`Hot-Doogy-Prep-Labels-${batchNumber(batch)}.pdf`);
  assert.equal(formatMoment('2026-10-13T22:30:00Z'),'10/13/2026 06:30 PM');
});
test('the PDF has one 2.4 x 3.5 inch page per label',async()=>{
  const pdf=await PDFDocument.load(await createPrepLabelsPdf(batch,labelRows(batch),{preparedBy:'Leonardo Oliveira'}));
  assert.equal(pdf.getPageCount(),6);
  const {width,height}=pdf.getPage(0).getSize();
  assert.equal(Math.round(width*100)/100,172.8);assert.equal(Math.round(height*100)/100,252);
  const plain=await PDFDocument.load(await createPrepLabelsPdf({...batch,name:'Açaí '.repeat(30),qty:1,actualQty:1},labelRows({...batch,qty:1,actualQty:1})));
  assert.equal(plain.getPageCount(),1);
});
test('use by is the production moment plus the shelf life, or blank without one',()=>{
  assert.equal(formatMoment(useByMoment(batch,7)),'10/20/2026 06:30 PM');
  for(const days of [null,undefined,'',0,-1,'abc'])assert.equal(useByMoment(batch,days),null);
});
