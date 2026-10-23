import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {operationsFixture} from '../fixtures/save-refresh.mjs';
import {projectData} from '../../server/live-data.mjs';
import {CATALOG_TABLES} from '../../server/workspace-scopes.mjs';
const {chromium}=await import(pathToFileURL(process.argv[2]).href);
const browser=await chromium.launch({headless:true,...(process.env.COUNT_BROWSER_CHANNEL?{channel:process.env.COUNT_BROWSER_CHANNEL}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);
const raw=operationsFixture(2);for(const row of raw.inventory_items)row.active=true;for(const row of raw.supplier_items)row.active=true;raw.suppliers[0].active=true;
for(const row of raw.location_inventory_items)row.active=true;
const responses={full:projectData(raw),catalog:projectData(Object.fromEntries(CATALOG_TABLES.map(t=>[t,raw[t]||[]]))),bootstrap:projectData({locations:raw.locations})};
for(const [scope,value] of Object.entries(responses)){value.meta.workspaceScope=scope;value.meta.preparationSalesStatus='idle';}
const reads=[],errors=[],assets=[];page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/src/'))assets.push(path);});let releaseFull,failFull=false;
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',async route=>{
 const url=new URL(route.request().url());
 if(url.pathname==='/api/auth/session')return route.fulfill({json:{user:{id:'actor',email:'test@example.invalid'},role:'owner'}});
 if(url.pathname==='/api/data'){
  const scope=url.searchParams.get('scope')||'full';reads.push(scope);
  if(scope==='full'){if(failFull)return route.fulfill({status:503,json:{error:'Temporary history failure'}});await new Promise(r=>releaseFull=r);}
  return route.fulfill({json:responses[scope]});
 }
 if(url.pathname==='/api/photos')return route.fulfill({json:{items:{},recipes:{}}});
 return route.fulfill({json:{}});
});
try{
 await page.goto('http://127.0.0.1:4196/#overview');
 // Original dashboard loads automatically; navigation remains usable during its request.
 await page.getByRole('status').filter({hasText:'Loading records'}).waitFor();
 assert.deepEqual(reads,['bootstrap','full']);assert.deepEqual(assets.sort(),['/src/app.bundle.css','/src/app.bundle.js']);
 assert.equal(await page.getByRole('button',{name:'View business summary',exact:true}).count(),0);
 await page.evaluate(()=>{location.hash='suppliers';});
 await page.locator('[data-action="supplier"]').first().waitFor();
 assert.ok(reads.includes('catalog'));await page.locator('[data-action="supplier"]').first().click();
 await page.locator('[data-action="supplier-item"]').first().click();await page.locator('#supplier-item-form').waitFor();
 releaseFull();await page.waitForTimeout(100);assert.equal(await page.locator('#supplier-item-form').count(),1);assert.equal(await page.evaluate(()=>location.hash),'#suppliers');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 // A failed history read is not rendered as zero records; retry remains usable.
 failFull=true;await page.evaluate(()=>{location.hash='inventory';});
 await page.getByText('Temporary history failure',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Try again',exact:true}).count(),1);
 failFull=false;releaseFull=null;await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByRole('status').filter({hasText:'Loading records'}).waitFor();
 for(let i=0;i<100&&!releaseFull;i++)await new Promise(r=>setTimeout(r,20));assert.ok(releaseFull);releaseFull();await page.locator('#main .stats, #main .inventory-workspace, #main table').first().waitFor();
 await page.evaluate(()=>{location.hash='overview';});
 await page.getByText('Net sales',{exact:true}).waitFor();
 await page.getByRole('heading',{name:'Needs your attention',exact:true}).waitFor();
 await page.getByRole('heading',{name:'Purchasing activity',exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS automatic original Overview, deferred history on other routes, navigation and catalog editing during delayed history, stale-response protection, visible failure and successful retry.');
}catch(error){console.error({reads,errors,screen:await page.locator('#main').innerText()});throw error;}finally{await browser.close();}
