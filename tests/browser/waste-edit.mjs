import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {operationsFixture} from '../fixtures/save-refresh.mjs';
import {projectData} from '../../server/live-data.mjs';
const {chromium}=await import(pathToFileURL(process.argv[2]).href);
const browser=await chromium.launch({headless:true,channel:process.env.COUNT_BROWSER_CHANNEL||'chrome'});
try{for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:1000}});const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
 const raw=operationsFixture(1);raw.recipes=[];raw.recipe_versions=[];raw.recipe_components=[];raw.recipe_steps=[];
 raw.inventory_items[0].active=true;raw.supplier_items[0].active=true;raw.suppliers[0].active=true;
 raw.waste_events=[{id:'waste-event',location_id:'location',occurred_at:'2026-10-20T20:00:00Z',reason:'Spoiled',notes:'Original',reported_by_name:'Original Reporter'}];
 raw.waste_event_lines=[{id:'waste-line',waste_event_id:'waste-event',inventory_item_id:'item-0',storage_area_id:'area',inventory_item_unit_id:'iu-0',quantity:2,quantity_base:2}];
 const data=projectData(raw);data.meta.preparationSalesStatus='ready';
 await page.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;let json={};
 if(path==='/api/auth/session')json={user:{id:'actor',email:'test@example.invalid'},role:'owner'};
 else if(path==='/api/data')json=data;
 else if(path==='/api/photos')json={items:{},recipes:{}};
 else if(path==='/api/hr')json={team:[],workdays:[],profiles:[],members:[],locations:data.locations,accounts:[]};
 else if(path==='/api/my-day')json={tasks:[],procedures:[],team:[],events:[],actions:[],assignments:[]};
 else if(req.method()==='POST'){writes.push({path,body:req.postDataJSON()});json={updated:true};}
 await route.fulfill({json});});
 await page.goto('http://127.0.0.1:4196/#waste');
 await page.locator('[data-action="waste-edit"]').click();
 assert.equal(await page.locator('#waste-quantity').inputValue(),'2');assert.equal(await page.locator('#waste-notes').inputValue(),'Original');
 assert.equal(await page.locator('#waste-location').isDisabled(),true);assert.equal(await page.locator('#waste-reporter').innerText(),'Original Reporter');
 await page.waitForTimeout(400);
 await page.screenshot({path:`/private/tmp/waste-edit-${width}.png`,fullPage:true});
 await page.locator('#waste-quantity').fill('3');await page.locator('#waste-reason').selectOption('Damaged');await page.locator('#waste-notes').fill('Corrected');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.locator('#waste-form').waitFor({state:'detached'});
 assert.equal(writes.length,1);assert.equal(writes[0].path,'/api/waste/edit');assert.equal(writes[0].body.payload.quantity,3);assert.equal(writes[0].body.expected.quantity,2);assert.equal(writes[0].body.lineId,'waste-line');
 await page.locator('[data-action="waste-new"]').click();assert.equal(await page.locator('#waste-quantity').inputValue(),'');assert.equal(await page.locator('#waste-location').isDisabled(),false);
 assert.deepEqual(errors,[]);console.log(`PASS waste edit and new-record reset at ${width}px`);await page.close();
}}finally{await browser.close();}
