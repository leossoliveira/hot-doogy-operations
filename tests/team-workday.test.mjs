import test from 'node:test';import assert from 'node:assert/strict';
import {PHONE_COUNTRIES,splitPhone,joinPhone} from '../src/phone-countries.js';
import {validateWorkdayExtraction,extractOpenClawWorkday} from '../server/openclaw-workday.mjs';
import {matchReportName} from '../src/workday-import-ui.js';
test('country phone preserves codes and shared country selection',()=>{
 assert.ok(PHONE_COUNTRIES.length>200);assert.deepEqual(splitPhone('7741234567'),{country:'US',number:'7741234567'});
 assert.equal(joinPhone('US','(774) 123-4567'),'+17741234567');assert.equal(joinPhone('BR','+55 11 99999-9999'),'+5511999999999');
 assert.deepEqual(splitPhone('+14165551234','CA'),{country:'CA',number:'4165551234'});assert.equal(joinPhone('US',''),'');assert.throws(()=>joinPhone('US','+55 11 999999999'));assert.throws(()=>joinPhone('US','abc'));
});
test('workday report rejects incomplete and invalid hours; matching is unique and accent insensitive',()=>{
 assert.throws(()=>validateWorkdayExtraction({document_complete:false,rows:[]}));assert.throws(()=>validateWorkdayExtraction({document_complete:true,rows:[{total_hours:25}]}));
 assert.equal(validateWorkdayExtraction({document_complete:true,rows:[{name:'José',date:null,total_hours:null}]}).rows[0].date,null);
 assert.equal(matchReportName('José Silva',[{name:'Jose Silva',id:'one'}]),'one');assert.equal(matchReportName('Jose Silva',[{name:'José Silva',id:'one'},{name:'Jose Silva',id:'two'}]),'');
});
test('OpenClaw workday extraction disables tools, requires completed output and validates data',async()=>{
 const config={url:'http://localhost/v1/responses',token:'test',agent:'invoice-analysis'};let body;
 const fetcher=async(_,o)=>{body=JSON.parse(o.body);return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({document_complete:true,rows:[{name:'Test Person',date:'2026-01-01',total_hours:7.5}]})}]}]})};};
 const result=await extractOpenClawWorkday(Buffer.from('employee,date,hours\nTest Person,2026-01-01,7.5'),'text/csv',{config,fetcher});assert.equal(result.extraction.rows[0].total_hours,7.5);assert.equal(body.tool_choice,'none');assert.match(body.instructions,/untrusted/);
 await assert.rejects(extractOpenClawWorkday(Buffer.from('x'),'text/csv',{config,fetcher:async()=>({ok:true,json:async()=>({status:'incomplete'})})}),/incomplete/);
});
