import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {operationsFixture} from '../fixtures/save-refresh.mjs';
import {projectData} from '../../server/live-data.mjs';
const {chromium}=await import(pathToFileURL(process.argv[2]).href);
const browser=await chromium.launch({headless:true,...(process.env.COUNT_BROWSER_CHANNEL?{channel:process.env.COUNT_BROWSER_CHANNEL}:{})});
const page=await browser.newPage();page.setDefaultTimeout(10000);
const photo=await readFile(new URL('../../public/brand/hot-doogy-print.png',import.meta.url));
const data=projectData(operationsFixture(2));data.meta.preparationSalesStatus='idle';
const candidate={id:'11111111-1111-1111-1111-111111111111',first_name:'José',last_name:'Test',reference:'HD-PDFTEST',status:'new',position:'crew_member',email:'candidate@example.invalid',phone:'15555550100',city:'Natick',state:'MA',availability:[],created_at:'2026-10-23T12:00:00Z'};
let withPhoto=false;const errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.route('**/api/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 if(path==='/api/auth/session')return route.fulfill({json:{user:{id:'actor',email:'test@example.invalid'},role:'owner'}});
 if(path==='/api/data')return route.fulfill({json:data});
 if(path==='/api/hr/careers')return route.fulfill({json:{applications:[candidate],files:withPhoto?[{id:'photo',application_id:candidate.id,kind:'selfie',mime_type:'image/png',file_name:'photo.png',size:100}]:[],notes:[],events:[]}});
 if(path.includes('/files/'))return route.fulfill({contentType:'image/png',body:photo});
 if(path==='/api/photos')return route.fulfill({json:{items:{},recipes:{}}});
 return route.fulfill({json:{}});
});
try{
 for(withPhoto of [false,true]){
  await page.goto('about:blank');
  await page.goto(`${process.env.CAREERS_TEST_URL||'http://127.0.0.1:4196'}/#hr-careers`);
  await page.locator('[data-action="careers-view"]').first().click();
  assert.equal(await page.locator('.modal-head #dialog-title').innerText(),'José Test');
  assert.equal(await page.locator('.modal-head .careers-contact').count(),1);
  assert.equal(await page.getByRole('button',{name:'Download PDF',exact:true}).count(),0);
  assert.equal(await page.locator('.modal-head .careers-profile-photo').count(),withPhoto?1:0);
  if(withPhoto)assert.equal(await page.getByRole('link',{name:'Download',exact:true}).count(),1);
  if(process.env.CAREERS_TEST_OUTPUT)await page.screenshot({animations:'disabled',path:`${process.env.CAREERS_TEST_OUTPUT}/careers-${withPhoto?'photo':'no-photo'}.png`});
  console.log(`PASS candidate header and files ${withPhoto?'with photo':'without photo'}; application PDF button removed`);
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
