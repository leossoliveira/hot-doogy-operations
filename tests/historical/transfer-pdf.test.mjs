import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTransferPdf,transferPrintLines,transferFilename} from '../../src/transfer-pdf.js';
import {PDFDocument} from '../../src/vendor/pdf-lib.esm.min.js';

test('real transfer PDF contains every row without changing the order',async()=>{
  const x=JSON.parse(await readFile(new URL('../../public/data/operations-detail.json',import.meta.url))).transfers[0];
  const before=structuredClone(x);
  const bytes=await createTransferPdf(x,{logoBytes:await readFile(new URL('../../public/brand/hot-doogy-print.png',import.meta.url))});
  const pdf=await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(),2);for(const page of pdf.getPages()){assert.equal(page.getWidth(),612);assert.equal(page.getHeight(),792);}assert.equal(pdf.getAuthor(),'Hot Doogy');assert.deepEqual(x,before);
});
