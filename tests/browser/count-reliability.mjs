import {pathToFileURL} from 'node:url';
import {countBrowserData} from '../fixtures/count-browser.mjs';
if(!process.argv[2])throw Error('Pass the path to an installed Playwright index.mjs; start the app on port 4196 first.');
const {chromium}=await import(pathToFileURL(process.argv[2]).href);
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,...(process.env.COUNT_BROWSER_CHANNEL?{channel:process.env.COUNT_BROWSER_CHANNEL}:{})});
const page=await browser.newPage();page.setDefaultTimeout(10000);page.on('console',m=>console.log('BROWSER',m.type(),m.text()));const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 console.log(await setup(page));
 const last=()=>[...countTest.records.values()].at(-1);
 await page.getByRole('button',{name:'Complete count',exact:true}).click();
 await page.locator('#form-error').filter({hasText:'No quantities have been entered'}).waitFor();assert.equal(last().status,'draft');
 console.log('empty guard passed');
 // A definitive save failure must not trap the next corrected edit.
 countTest.failNext=true;await page.locator('[data-count="row1"]').fill('4');
 await page.locator('#count-save-status').filter({hasText:'not synced'}).waitFor();
 await page.locator('[data-count="row1"]').fill('5');
 await page.locator('#count-save-status').filter({hasText:'Draft saved'}).waitFor();assert.equal(last().state.lines.find(x=>x.rowId==='row1').qty,'5');
 console.log('rejection recovery passed');
 // Search hides the blank second item. Cancel must not write zeros locally or remotely.
 await page.locator('[data-input="count-search"]').fill('Test item 1');
 let prompt='';page.once('dialog',async d=>{prompt=d.message();await d.dismiss();});
 await page.getByRole('button',{name:'Mark section complete',exact:true}).click();
 assert.match(prompt,/1 of 2/);assert.match(prompt,/hidden by search/);assert.equal(last().state.lines.find(x=>x.rowId==='row2').qty,'');
 console.log('cancel passed');
 // A confirmed but rejected publish must also leave the blank untouched.
 countTest.failNext=true;page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Mark section complete',exact:true}).click();
 await page.locator('#count-save-status').filter({hasText:'not synced'}).waitFor();
 const cache=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('hot-doogy.count-draft.')))));
 assert.equal(cache.state.lines.find(x=>x.rowId==='row2').qty,'');
 await page.locator('[data-input="count-search"]').fill('');
 assert.equal(await page.locator('[data-count="row2"]').inputValue(),'');
 console.log('failure preservation passed');
 // Close and resume retains quantities/notes.
 await page.locator('#count-notes').fill('Keep this recovery note');
 await page.getByRole('button',{name:'Save & close',exact:true}).click();
 await page.getByRole('button',{name:'Resume',exact:true}).click();
 assert.equal(await page.locator('[data-count="row1"]').inputValue(),'5');assert.equal(await page.locator('#count-notes').inputValue(),'Keep this recovery note');
 console.log('resume passed');
 // Older cache must be archived, not overwrite a newer database version.
 await page.getByRole('button',{name:'Save & close',exact:true}).click();
 await page.locator('#count-form').waitFor({state:'detached'});
 await page.evaluate(()=>{const key=Object.keys(localStorage).find(k=>k.startsWith('hot-doogy.count-draft.'));const cache=JSON.parse(localStorage.getItem(key));cache.version-=1;cache.state.notes='Unsynced older note';localStorage.setItem(key,JSON.stringify(cache));});
 await page.getByRole('button',{name:'Resume',exact:true}).click();
 await page.getByRole('button',{name:'Download local copy',exact:true}).waitFor();assert.equal(await page.locator('#count-notes').inputValue(),'Keep this recovery note');
 assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.includes('.recovery.')&&JSON.parse(localStorage.getItem(k)).state.notes==='Unsynced older note')),true);
 // An ambiguous completion freezes edits until its exact receipt is recovered.
 countTest.loseCompletion=true;page.once('dialog',d=>d.accept());
 await page.getByRole('button',{name:'Complete count',exact:true}).click();
 await page.locator('#form-error').filter({hasText:'Completion has not been confirmed'}).waitFor();
 assert.equal(await page.locator('#count-rows').evaluate(e=>e.inert),true);
 assert.equal(await page.locator('#count-notes').isDisabled(),true);
 assert.equal(last().status,'completed');const countBeforeRetry=countTest.calls.length;
 await page.getByRole('button',{name:'Retry saving draft',exact:true}).click();
 await page.locator('#count-form').waitFor({state:'detached'});
 assert.equal(countTest.calls.length,countBeforeRetry+1);
 assert.equal(countTest.calls.at(-1).requestId,countTest.calls.at(-2).requestId);
 assert.deepEqual(errors,[]);
 console.log('PASS browser: empty count blocked; rejected save corrected; hidden blanks confirmed; canceled/failed publish preserves blanks; close/resume; stale recovery archived.');
}catch(e){console.log('DIAGNOSTIC',await page.locator('body').innerText(),errors);throw e;}finally{await browser.close();}

async function setup(page) {
 const fixture=countBrowserData();const records=new Map();globalThis.countTest={records,calls:[],failNext:false};await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;let body={};
 if(path==='/api/auth/session')body={user:{id:'actor',email:'test@example.invalid'},role:'staff'};
 else if(path==='/api/data'){body=structuredClone(fixture);body.inventoryHistory.sessions=[...records.values()].map(r=>({id:r.id,locationId:r.location_id,createdBy:r.created_by,employeeName:r.employee_name,status:r.status,state:r.state,published:r.published,version:r.version,createdAt:r.created_at,countedAt:r.created_at,source:'session',lines:[]}));}
 else if(path==='/api/inventory/counter')body={name:'Test Employee'};
 else if(path==='/api/photos')body={items:{},recipes:{}};
 else if(path==='/api/inventory/count-draft'){const p=route.request().postDataJSON();countTest.calls.push(p);if(countTest.failNext){countTest.failNext=false;await route.fulfill({status:422,json:{error:'Review the selected units. Your draft is preserved.'}});return;}const old=records.get(p.id);if(old?.last_request===p.requestId){await route.fulfill({json:old});return;}if(p.expectedVersion!==(old?.version||0)){await route.fulfill({status:409,json:{error:'stale'}});return;}const published=old?.published||{};if(p.action!=='save'){for(const section of new Set(p.state.lines.map(l=>l.section))){if(p.action==='section'&&p.section!==section)continue;published[section]=p.state.lines.filter(l=>l.section===section).sort((a,b)=>a.rowId.localeCompare(b.rowId)).map(l=>({itemId:l.itemId,itemUnitId:l.itemUnitId,qty:Number(l.qty||0)}));}}body={id:p.id,location_id:p.locationId,created_by:'actor',employee_name:'Test Employee',status:p.action==='complete'?'completed':'draft',state:p.state,published,version:(old?.version||0)+1,created_at:old?.created_at||new Date().toISOString()};body.last_request=p.requestId;records.set(p.id,body);if(countTest.loseCompletion&&p.action==='complete'){countTest.loseCompletion=false;await route.fulfill({status:502,json:{error:'Response lost'}});return;}}
 await route.fulfill({json:body});});
 await page.goto('http://127.0.0.1:4196/#inventory');await page.getByRole('button',{name:'New count',exact:true}).click();await page.locator('#count-location').selectOption('22222222-2222-4222-8222-222222222222');await page.getByRole('button',{name:'Start count',exact:true}).click();await page.locator('#count-entry').waitFor({state:'visible'});return {title:await page.title(),rows:await page.locator('[data-count]').count(),drafts:records.size,status:await page.locator('#count-save-status').innerText()};
}
