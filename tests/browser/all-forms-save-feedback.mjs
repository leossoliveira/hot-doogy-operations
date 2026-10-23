import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {operationsFixture} from '../fixtures/save-refresh.mjs';
import {countBrowserData} from '../fixtures/count-browser.mjs';
import {projectData} from '../../server/live-data.mjs';
const {chromium}=await import(pathToFileURL(process.argv[2]).href);
const browser=await chromium.launch({headless:true,...(process.env.COUNT_BROWSER_CHANNEL?{channel:process.env.COUNT_BROWSER_CHANNEL}:{})});
const orderId='11111111-1111-4111-8111-111111111111',invoiceId='33333333-3333-4333-8333-333333333333';
function fixture(){const raw=operationsFixture(2);for(const row of raw.inventory_items)row.active=true;for(const row of raw.supplier_items)row.active=true;raw.suppliers[0].active=true;const data=projectData(raw);data.meta.preparationSalesStatus='ready';data.orders=[{id:orderId,number:'TEST-ORDER',status:'draft',dbStatus:'draft',supplierId:'supplier',supplierName:'Supplier',locationId:'location',locationName:'Store',updatedAt:'2026-10-01T00:00:00Z',lines:[{id:'line',supplierItemId:'vendor-0',itemId:'item-0',name:'Item 0',itemName:'Item 0',orderedPurchaseQty:1,orderedQuantity:1,remainingPurchaseQty:1,purchaseItemUnitId:'iu-0',itemUnitId:'iu-0',uom:'Each',unitFactor:1}],receipts:[],invoices:[]}];data.invoices=[{id:invoiceId,number:'TEST-INVOICE',status:'unpaid',dbStatus:'unpaid',supplierId:'supplier',supplierName:'Supplier',locationId:'location',locationName:'Store',date:'2026-10-01',dueDate:'2026-11-01',total:10,updatedAt:'2026-10-01T00:00:00Z',lines:[],documents:[]}];return data;}
async function scenario(name,routeName,exercise,{data=fixture(),writePath,after}={}){
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(8000);const errors=[],writes=[],held=[];let saved=false,blockedReads=0;page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{const request=route.request(),path=new URL(request.url()).pathname;
  if(request.method()==='GET'&&saved&&['/api/data','/api/hr','/api/my-day'].includes(path)){blockedReads++;held.push(route);return;}
  let json={};
  if(path==='/api/auth/session')json={user:{id:'actor',email:'test@example.invalid'},role:'owner'};
  else if(path==='/api/data')json=data;
  else if(path==='/api/photos')json={items:{},recipes:{}};
  else if(path==='/api/hr')json={team:[],workdays:[],profiles:[],members:[],locations:data.locations,accounts:[]};
  else if(path==='/api/my-day')json={tasks:[],procedures:[],team:[{id:'tester',first_name:'Synthetic',last_name:'Tester',status:'active',location_ids:['location']}],events:[],actions:[],assignments:[]};
  else if(path==='/api/invoices/analysis-jobs'||path==='/api/invoices/team-members')json=[];
  else if(path==='/api/inventory/counter')json={name:'Synthetic Tester'};
  else if(request.method()==='POST'){
   const body=request.postDataJSON();writes.push({path,body});saved=saved||(writePath?path===writePath:true);
   if(path==='/api/inventory/count-draft'){saved=body.action==='complete';json={id:body.id,location_id:body.locationId,created_by:'actor',employee_name:'Synthetic Tester',status:saved?'completed':'draft',state:body.state,published:{},version:body.expectedVersion+1,created_at:'2026-10-20T12:00:00Z'};}else json={ok:true,updatedAt:'2026-10-20T12:00:00Z'};
  }
  return route.fulfill({json});
 });
 try{await page.goto('http://127.0.0.1:4196/#'+routeName);await page.locator('#main').waitFor();await exercise(page);await page.waitForTimeout(150);assert.ok(saved,name+' wrote');assert.ok(blockedReads>0,name+' held a refresh');if(after)await after(page,writes);assert.deepEqual(errors,[]);console.log('PASS '+name+': confirmed while list response is held.');}
 catch(error){console.error(name,await page.locator('body').innerText(),errors);throw error;}
 finally{for(const route of held)await route.fulfill({status:503,json:{error:'Refresh unavailable'}}).catch(()=>{});await page.close();}
}
async function confirmed(page,selector,message){await page.locator(selector).waitFor({state:'detached',timeout:1500});await page.getByText(message,{exact:true}).waitFor({timeout:1500});}
try{
 await scenario('order edit','purchases',async page=>{
  await page.getByRole('button',{name:'History',exact:true}).click();await page.locator('[data-action="order"]').first().click();await page.getByRole('button',{name:'Edit order',exact:true}).click();await page.locator('#order-edit-notes').fill('Saved note');await page.getByRole('button',{name:'Save changes',exact:true}).click();await confirmed(page,'#order-edit-form','Order saved.');
  await page.locator('[data-action="order"]').first().click();assert.equal(await page.locator('#order-edit-form').count(),0);await page.getByText('Saved. The latest details are still updating; you can keep working elsewhere.',{exact:true}).waitFor();
 },{writePath:'/api/orders/'+orderId+'/edit',after:async(page,writes)=>assert.equal(writes.length,1)});
 await scenario('new purchase order','purchases',async page=>{
  await page.locator('[data-action="new-order"]').click();await page.locator('#supplierId').selectOption('supplier');await page.locator('#locationId').selectOption('location');await page.getByRole('combobox',{name:'Item 1',exact:true}).fill('Item 0');await page.getByRole('listbox',{name:'Item 1 results',exact:true}).getByRole('option').first().click();await page.locator('[data-action="save-record"]').click();await confirmed(page,'#record-form','Draft saved.');
 },{writePath:'/api/command'});
 await scenario('invoice payment','invoices',async page=>{
  await page.locator('[data-action="invoice"]').first().click();await page.getByRole('button',{name:'Mark as paid',exact:true}).click();await page.getByRole('button',{name:'Save payment',exact:true}).click();await confirmed(page,'#invoice-payment-date','Payment recorded.');
 },{writePath:'/api/invoices/'+invoiceId+'/status'});
 const reviewData=fixture();Object.assign(reviewData.invoices[0],{status:'review',dbStatus:'draft',intakeSource:'llm',subtotal:0,tax:0,fees:0,total:0,currency:'USD'});
 await scenario('invoice review approval','invoices',async page=>{
  await page.locator('[data-action="invoice"]').first().click();await page.locator('[data-action="llm-edit"]').first().click();await page.getByRole('button',{name:'Approve Invoice',exact:true}).click();await confirmed(page,'#llm-review','Invoice approved.');
 },{data:reviewData,writePath:'/api/invoices/'+invoiceId+'/edit-draft',after:async(page,writes)=>{assert.equal(writes.length,2);assert.equal(writes[1].body.expectedUpdatedAt,'2026-10-20T12:00:00Z');assert.equal(writes[1].body.confirmed,true);}});
 await scenario('inventory count completion','inventory',async page=>{
  await page.getByRole('button',{name:'New count',exact:true}).click();await page.locator('#count-location').selectOption('22222222-2222-4222-8222-222222222222');await page.getByRole('button',{name:'Start count',exact:true}).click();await page.locator('[data-count="row1"]').fill('2');await page.locator('[data-count="row2"]').fill('3');await page.locator('[data-count="row3"]').fill('4');await page.getByRole('button',{name:'Complete count',exact:true}).click();await confirmed(page,'#count-form','Inventory count completed.');
 },{data:countBrowserData()});
 await scenario('HR form','hr-team',async page=>{
  await page.locator('[data-action="hr-new-team"]').click();const form=page.locator('#hr-form');await form.locator('[name="first_name"]').fill('Synthetic');await form.locator('[name="last_name"]').fill('Tester');await page.locator('[data-action="hr-save"]').click();await confirmed(page,'#hr-form','HR record saved.');
 },{writePath:'/api/hr/save'});
 await scenario('activity task','my-day',async page=>{
  await page.locator('[data-action="my-day-new-task"]').click();await page.locator('#day-form [name="title"]').fill('Synthetic procedure');await page.locator('#day-form [name="assignee_id"]').selectOption('tester');await page.locator('[data-action="my-day-save"]').click();await confirmed(page,'#day-form','Saved.');
 },{writePath:'/api/my-day/save'});
}finally{await browser.close();}
