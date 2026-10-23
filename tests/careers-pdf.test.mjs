import test from 'node:test';
import assert from 'node:assert/strict';
import {createApplicationPdf} from '../src/careers-pdf.js';
import {PDFDocument} from '../src/vendor/pdf-lib.esm.min.js';
const application={first_name:'José',last_name:'Souza',reference:'HD-TEST',email:'test@example.com',availability:[],pitch:'Experience '.repeat(2500)};
test('application PDF paginates long answers and supports absent optional fields',async()=>{
 const bytes=await createApplicationPdf(application,{location:'Sherwood Plaza'});
 const pdf=await PDFDocument.load(bytes);
 assert.ok(pdf.getPageCount()>2);
 assert.match(pdf.getTitle(),/Employment application/);
 assert.ok(pdf.getPages().every(p=>p.getWidth()===612&&p.getHeight()===792));
});
