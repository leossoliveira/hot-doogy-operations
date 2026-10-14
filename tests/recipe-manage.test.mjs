import test from 'node:test';import assert from 'node:assert/strict';
import {manageState,manageChanges,manageView,useByText} from '../src/recipe-manage.js';

const item={id:'item',name:'Panini Mix',baseUnitName:'Each',units:[{id:'each',unitId:'each',name:'Each',factor:1,base:true},{id:'tray',unitId:'tray',name:'Tray',factor:10,base:false}]};
const recipe={id:'r',type:'prep',name:'Panini Mix',useByDays:null,yieldQuantity:50,yieldUomId:'each',yieldUom:'Each',outputItemId:'item'};

test('unchanged state sends no management keys',()=>{
  assert.deepEqual(manageChanges(recipe,item,manageState(recipe,item)),{});
});
test('changed fields are sent alone',()=>{
  const s=manageState(recipe,item);s.name='  Panini Mix Classic ';s.useByDays='3';
  assert.deepEqual(manageChanges(recipe,item,s),{name:'Panini Mix Classic',useByDays:3});
  const clear=manageState({...recipe,useByDays:4},item);clear.useByDays='';
  assert.deepEqual(manageChanges({...recipe,useByDays:4},item,clear),{useByDays:null});
});
test('yield and conversions',()=>{
  const s=manageState(recipe,item);s.units[1].factor='12';s.units.push({unitId:'pan',name:'Pan',factor:'24',base:false});s.yieldQuantity='2';s.yieldUnitId='pan';
  assert.deepEqual(manageChanges(recipe,item,s),{units:[{unitId:'tray',factor:12},{unitId:'pan',factor:24}],yieldQuantity:2,yieldUnitId:'pan'});
});
test('invalid input is rejected with a readable message',()=>{
  const cases=[[s=>s.name='  ',/name/],[s=>s.useByDays='0',/Use by/],[s=>s.useByDays='2.5',/Use by/],[s=>s.useByDays='366',/Use by/],
    [s=>s.units[1].factor='0',/Tray/],[s=>s.units[1].factor='',/Tray/],[s=>s.units[0].factor='2',/base unit/],[s=>s.yieldQuantity='',/yield/],[s=>s.yieldUnitId='gone',/yield unit/]];
  for(const [edit,error] of cases){const s=manageState(recipe,item);edit(s);assert.throws(()=>manageChanges(recipe,item,s),error);}
});
test('recipe without a yield can stay without one; no prep item skips yield and conversions',()=>{
  const bare={...recipe,yieldQuantity:null,yieldUomId:null};const s=manageState(bare,item);
  assert.deepEqual(manageChanges(bare,item,s),{});
  assert.deepEqual(manageChanges({...recipe,outputItemId:null},null,{...manageState(recipe,null),useByDays:'2'}),{useByDays:2});
});
test('views escape names and describe use by',()=>{
  assert.equal(useByText(null),'Not set');assert.equal(useByText(1),'1 day after prep');assert.equal(useByText(3),'3 days after prep');
  const html=manageView({...recipe,name:'<b>x</b>',useByDays:2},item);assert.match(html,/&lt;b&gt;/);assert.match(html,/2 days after prep/);assert.match(html,/1 Tray/);
  const edit=manageView(recipe,item,{editing:true,state:manageState(recipe,item),allUnits:[{id:'each',name:'Each'},{id:'pan',name:'Pan'}]});
  assert.match(edit,/data-recipe-manage="useByDays"/);assert.match(edit,/<option value="pan">Pan<\/option>/);assert.doesNotMatch(edit,/<option value="each">Each<\/option><\/select><button/);
});
