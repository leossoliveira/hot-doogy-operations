import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {operationsFixture} from '../fixtures/save-refresh.mjs';
import {projectData} from '../../server/live-data.mjs';
const {chromium}=await import(pathToFileURL(process.argv[2]).href);
const browser=await chromium.launch({headless:true,...(process.env.COUNT_BROWSER_CHANNEL?{channel:process.env.COUNT_BROWSER_CHANNEL}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);
const raw=operationsFixture(2);for(const row of raw.inventory_items){row.active=true;row.track_inventory=true;row.updated_at='2026-10-01T00:00:00Z';}for(const row of raw.supplier_items)row.active=true;raw.suppliers[0].active=true;
const data=projectData(raw);data.meta.preparationSalesStatus='idle';
let mode='reject',refreshFails=false;const writes=[],creates=[],errors=[],reads=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 if(path==='/api/auth/session')return route.fulfill({json:{user:{id:'actor',email:'test@example.invalid'},role:'owner'}});
 if(path==='/api/data'){reads.push(route.request().url());return route.fulfill(refreshFails?{status:503,json:{error:'Refresh temporarily unavailable'}}:{json:data});}
 if(path==='/api/photos')return route.fulfill({json:{items:{},recipes:{}}});
 if(path==='/api/command'){
  const body=route.request().postDataJSON();writes.push(body);
  if(mode==='reject'){mode='lost';return route.fulfill({status:503,json:{error:'The database is busy. Your changes have not been saved. Please retry shortly.',code:'57014',rejected:true}});}
  if(mode==='lost'){mode='success';return route.abort('connectionreset');}
  refreshFails=true;return route.fulfill({json:{ok:true}});
 }
 if(path==='/api/catalog/create'){
  creates.push(route.request().postDataJSON());
  if(creates.length===1)return route.fulfill({status:502,json:{error:'The database rejected this save. No changes were saved. Please retry after the service is corrected.',code:'21000',rejected:true}});
  if(creates.length===2)return route.abort('connectionreset');
  return route.fulfill({json:{ok:true}});
 }
 if(path==='/api/hr')return route.fulfill({json:{team:[],workdays:[],profiles:[],members:[],locations:data.locations,users:[]}});
 if(path==='/api/my-day')return route.fulfill({json:{procedures:[],routines:[],tasks:[],events:[],actions:[],team:[],assignments:[]}});
 if(path==='/api/hr/careers')return route.fulfill({json:{applications:[],positions:[]}});
 if(path==='/api/invoices/analysis-jobs')return route.fulfill({json:[]});
 return route.fulfill({json:{}});
});
try{
 await page.goto('http://127.0.0.1:4196/#suppliers');await page.locator('[data-action="supplier"]').first().click();
 await page.locator('[data-action="supplier-item"]').first().click();
 assert.doesNotMatch(await page.locator('.catalog-save-note').innerText(),/Changes saved/);assert.ok(reads.every(url=>!url.includes('sales=1')));
 await page.locator('#catalog-price').fill('69.99');await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await page.locator('#supplier-item-error').filter({hasText:'database is busy'}).waitFor();assert.equal(await page.locator('#catalog-price').inputValue(),'69.99');assert.equal(await page.locator('#catalog-price').isEnabled(),true);
 await page.locator('#catalog-price').fill('70.25');await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await page.locator('#supplier-item-error').filter({hasText:'could not be confirmed'}).waitFor();assert.equal(await page.locator('#catalog-price').isDisabled(),true);
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.locator('#supplier-item-form').waitFor({state:'detached'});
 assert.equal(writes.length,3);assert.notEqual(writes[0].commandId,writes[1].commandId);assert.deepEqual(writes[1],writes[2]);
 await page.getByText(/Saved\. Screen refresh pending/).waitFor();
 console.log('PASS supplier edit: DB timeout is actionable; fields retained; unknown response replays exactly; refresh failure does not reverse successful save.');
 refreshFails=false;await page.locator('[data-action="supplier-back"]').click();await page.locator('[data-action="supplier-create"]').click();
 await page.locator('#supplier-create-form [name="name"]').fill('Synthetic supplier');await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.locator('#supplier-create-error').filter({hasText:'No changes were saved'}).waitFor();
 assert.equal(await page.locator('#supplier-create-form [name="name"]').isEnabled(),true);
 await page.locator('#supplier-create-form [name="name"]').fill('Corrected synthetic supplier');await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.locator('#supplier-create-error').filter({hasText:'not be confirmed'}).waitFor();
 await page.reload();await page.locator('[data-action="supplier-create"]').click();
 await page.locator('#supplier-create-error').filter({hasText:'previous save was not confirmed'}).waitFor();
 assert.equal(await page.locator('#supplier-create-form [name="name"]').inputValue(),'Corrected synthetic supplier');
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.locator('#supplier-create-form').waitFor({state:'detached'});assert.deepEqual(creates[1],creates[2]);
 console.log('PASS supplier creation: confirmed rejection unlocks fields; response loss survives reload and retries the exact draft without a duplicate.');
 for(const route of ['overview','inventory','suppliers','recipes','purchases','preparation','invoices','transfers','waste','reports','hr-team','my-day']){
  await page.evaluate(route=>{location.hash=route;},route);await page.waitForTimeout(80);assert.ok((await page.locator('#app').innerText()).length>100);assert.equal(await page.evaluate(()=>location.hash),'#'+route);
 }
 assert.ok(reads.some(url=>url.includes('sales=1')));assert.deepEqual(errors,[]);console.log('PASS module navigation smoke: no unhandled browser exceptions; calculations requested only on consuming routes.');
}catch(error){console.error(await page.locator('body').innerText(),errors);throw error;}finally{await browser.close();}

// Keep the post-save read unresolved: confirmation must depend only on the write.
await browserForRefresh();
async function browserForRefresh(){
 const isolated=await chromium.launch({headless:true,...(process.env.COUNT_BROWSER_CHANNEL?{channel:process.env.COUNT_BROWSER_CHANNEL}:{})});
 const tab=await isolated.newPage({viewport:{width:1440,height:1000}});tab.setDefaultTimeout(10000);
 let hold=false,release;const gate=new Promise(resolve=>release=resolve);let readsStarted=0,readsFinished=0;
 const refreshed=structuredClone(data);refreshed.supplierCatalog.items[0].itemUpdatedAt='2026-10-20T23:00:00Z';
 try{
  await tab.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/api/auth/session')return route.fulfill({json:{user:{id:'actor',email:'test@example.invalid'},role:'owner'}});
   if(path==='/api/photos')return route.fulfill({json:{items:{},recipes:{}}});
   if(path==='/api/data'){if(hold){readsStarted++;await gate;readsFinished++;}return route.fulfill({json:hold?refreshed:data});}
   if(path==='/api/command'){hold=true;return route.fulfill({json:{ok:true}});}
   return route.fulfill({json:{}});
  });
  await tab.goto('http://127.0.0.1:4196/#suppliers');await tab.locator('[data-action="supplier"]').first().click();
  const ids=await tab.locator('[data-action="supplier-item"]').evaluateAll(rows=>[...new Set(rows.map(row=>row.dataset.id))]);
  await tab.locator(`[data-action="supplier-item"][data-id="${ids[0]}"]`).first().click();
  const started=Date.now();await tab.getByRole('button',{name:'Save changes',exact:true}).click();
  await tab.locator('#supplier-item-form').waitFor({state:'detached',timeout:1500});
  assert.ok(Date.now()-started<1500);await tab.getByText('Item details updated in the database.',{exact:true}).waitFor();
  assert.equal(readsFinished,0);assert.ok(readsStarted>0);
  await tab.locator(`[data-action="supplier-item"][data-id="${ids[0]}"]`).first().click();
  assert.equal(await tab.locator('#supplier-item-form').count(),0);
  await tab.getByText(/latest details are still updating/).waitFor();
  await tab.locator(`[data-action="supplier-item"][data-id="${ids[1]}"]`).first().click();
  await tab.locator('#catalog-internalName').fill('Keep this new edit');
  release();await tab.waitForTimeout(150);
  assert.equal(await tab.locator('#catalog-internalName').inputValue(),'Keep this new edit');
  await tab.getByRole('button',{name:'Cancel',exact:true}).click();await tab.getByRole('button',{name:'Discard changes',exact:true}).click();
  await tab.evaluate(()=>window.dispatchEvent(new Event('focus')));await tab.waitForTimeout(150);
  await tab.locator(`[data-action="supplier-item"][data-id="${ids[0]}"]`).first().click();
  await tab.locator('#supplier-item-form').waitFor();
  console.log('PASS immediate confirmation before a held refresh; saved item waits for current versions; late response preserves a new edit; refreshed item reopens.');
 }finally{release();await isolated.close();}
}
