import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {measurementSystem,prioritizeUnits,preferredUnit,convertQuantity,countEntry} from '../src/units.js';
import {usDate,usTime,countMoments} from '../src/locale.js';
import {number,money,preciseNumber,safeCsv} from '../src/model.js';
import {latestInventoryFor} from '../src/inventory-model.js';
import {databaseErrorMessage} from '../server/database-errors.mjs';
import {createAuth} from '../server/auth.mjs';
const g={id:'g',itemUnitId:'item-g',name:'Gram',kind:'mass',factor:1,base:true,stocktake:true};
const oz={id:'oz',itemUnitId:'item-oz',name:'Ounce',kind:'mass',factor:28.349523125};
const lb={id:'lb',itemUnitId:'item-lb',name:'Pound',kind:'mass',factor:453.59237};
const kg={id:'kg',itemUnitId:'item-kg',name:'Kilogram',kind:'mass',factor:1000};
const item={id:'ingredient',rowId:'row',locationId:'store',stocktakeUom:'Gram',units:[g,kg,oz,lb]};

test('US units come first without changing unit identities, factors, or existing defaults',()=>{
 const original=structuredClone(item);
 assert.deepEqual(prioritizeUnits(item.units).map(u=>u.id),['oz','lb','g','kg']);
 assert.equal(preferredUnit(item.units,g),oz);
 assert.equal(preferredUnit([g,kg],g),g);
 const pack={id:'case',name:'Case',kind:'package',factor:500};
 assert.equal(preferredUnit([...item.units,pack],pack),pack);
 assert.deepEqual(item,original);
});
test('volume, weight, packaging, and diluted units keep distinct meanings',()=>{
 assert.equal(measurementSystem({code:'floz',kind:'volume'}),'us');
 assert.equal(measurementSystem({name:'Liter'}),'metric');
 assert.equal(measurementSystem({name:'Cup',kind:'package',code:'cup_package'}),'other');
 assert.equal(measurementSystem({name:'Fluid Ounce (Diluted Drink)',code:'floz_diluted'}),'other');
 assert.equal(measurementSystem({name:'Cup',kind:'volume'}),'us');
 assert.equal(measurementSystem({code:'oz',kind:'mass'}),'us');
});
test('US and metric counts produce the same base quantity in a database-approved count unit',()=>{
 const original=structuredClone(item),us=countEntry(item,16,'item-oz'),metric=countEntry(item,453.59237,'item-g');
 assert.equal(us.qty,metric.qty);assert.equal(us.baseQty,453.59237);
 assert.equal(us.itemUnitId,'item-g');assert.equal(us.uom,'Gram');
 assert.equal(countEntry(item,0,'item-kg').baseQty,0);
 const local={counts:[{locationId:'store',date:'2026-10-05',moment:countMoments[0].value,lines:[us]}]};
 assert.equal(latestInventoryFor(item,local).qty,453.59237);
 assert.deepEqual(item,original);
});
test('unit changes preserve actual quantities and reject unknown or missing conversions',()=>{
 assert.equal(convertQuantity(16,oz,lb),1);
 assert.equal(convertQuantity(1,kg,g),1000);
 assert.equal(convertQuantity(convertQuantity(12.5,oz,g),g,oz),12.5);
 for(const value of ['',null,undefined,true,[],Infinity,'1,5'])assert.equal(convertQuantity(value,g,oz),null);
 assert.equal(convertQuantity(1,g,{factor:0}),null);
 assert.throws(()=>countEntry(item,5,'unregistered'),/valid count/);
 assert.throws(()=>countEntry({...item,units:[oz]},1,'item-oz'),/valid count/);
 assert.throws(()=>countEntry(item,-1,'item-g'),/valid count/);
});
test('English count labels retain database enum compatibility and chronological ordering',async()=>{
 const sql=await readFile(new URL('../database/operations-command.sql',import.meta.url),'utf8');
 for(const moment of countMoments)assert.ok(sql.includes("'"+moment.value+"'"));
 assert.deepEqual(countMoments.map(m=>m.label),['Before opening','During business hours','After closing']);
 const local={counts:countMoments.map((m,i)=>({locationId:'store',date:'2026-10-05',moment:m.value,lines:[countEntry(item,i,'item-g')]})).reverse()};
 assert.equal(latestInventoryFor(item,local).qty,2);
});
test('US formatting uses month/day/year, AM/PM, USD, decimal points and comma-separated CSV',()=>{
 assert.equal(usDate('2026-10-05'),'10/05/2026');
 assert.equal(usTime('00:00'),'12:00 AM');assert.equal(usTime('12:15'),'12:15 PM');assert.equal(usTime('23:59'),'11:59 PM');
 assert.equal(number(1234.5),'1,234.5');assert.equal(preciseNumber(.002834),'0.002834');assert.equal(money(1234.5),'$1,234.50');
 assert.equal(safeCsv([{n:1.5,name:'A, B'}],[{label:'Quantity',value:'n'},{label:'Name',value:'name'}]),'\ufeff"Quantity","Name"\r\n"1.5","A, B"');
});
test('known database validations are translated and unknown messages are not exposed',async()=>{
 const sql=await readFile(new URL('../database/operations-command.sql',import.meta.url),'utf8');
 for(const [,message]of sql.matchAll(/raise exception '([^']+)'/g)){
  if(message.includes('%'))continue;
  const translated=databaseErrorMessage({code:'P0001',message});
  assert.notEqual(translated,message);assert.doesNotMatch(translated,/Unable to complete/,message);
 }
 assert.match(databaseErrorMessage({message:'private database details'}),/Unable to complete/);
 const auth=createAuth({fetcher:async()=>({ok:false,status:400,json:async()=>({code:'P0001',message:'Receita alterada. Reabra antes de salvar.'})})});
 await assert.rejects(auth.request('/rest/v1/rpc/test'),/This recipe has changed. Reopen it before saving/);
});
