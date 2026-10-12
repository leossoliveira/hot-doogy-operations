import test from 'node:test';import assert from 'node:assert/strict';
import {insightEvidence,parseInsights,createInsightsService} from '../server/doogy-insights.mjs';
import {canViewRoute} from '../src/access.js';
const data=()=>({locations:[{id:'a',name:'A'},{id:'b',name:'B'}],costInputs:{menus:[{id:'m',name:'Burger'}]},recipes:[],salesPeriods:{facts:[{locationId:'a',menuItemId:'m',date:'2026-10-01',quantity:2,netSales:10,grossSales:10,discounts:0},{locationId:'b',menuItemId:'m',date:'2026-10-01',quantity:3,netSales:20,grossSales:20,discounts:0}],batches:[]},items:[],invoices:[],waste:[]});
const requestId='11111111-1111-4111-8111-111111111111';
test('insight evidence respects location scope and imported dates, and rejects unavailable locations',()=>{
 const evidence=insightEvidence(data(),'a');assert.match(evidence.facts[0].detail,/\$10.00/);assert.doesNotMatch(evidence.facts[0].detail,/\$30.00/);assert.equal(evidence.period,'09/25/2026–10/01/2026');assert.throws(()=>insightEvidence(data(),'other'),/available/);
});
test('AI insights require bounded English card fields and references to actual evidence',()=>{
 const evidence=insightEvidence(data(),'a'),card={title:'Review mix',finding:'Burger contributes sales.',action:'Review the item report.',priority:'medium',evidenceId:'mix0'};
 assert.equal(parseInsights(JSON.stringify({insights:[card]}),evidence)[0].evidence.id,'mix0');assert.throws(()=>parseInsights(JSON.stringify({insights:[{...card,evidenceId:'invented'}]}),evidence),/unsupported/);assert.throws(()=>parseInsights('not json',evidence),/read/);
});
test('insights are administrator-only, bind jobs to session, reuse retry identity and expose no internal actor',async()=>{
 const calls=[],agent={send:async(...args)=>{calls.push(args);return {accepted:true};},history:async()=>({messages:[{role:'assistant',text:JSON.stringify({insights:[{title:'Sales',finding:'Review recorded sales.',action:'Check the sales report.',priority:'low',evidenceId:'sales'}]})}]})};
 const service=createInsightsService(agent),session={member:{role:'owner'},user:{id:'owner'}};
 await assert.rejects(service.start({member:{role:'staff'}},data(),'a',requestId),/administrators/);assert.equal(calls.length,0);
 await service.start(session,data(),'a',requestId);await service.start(session,data(),'a',requestId);assert.equal(calls.length,1);assert.ok(calls[0][2].text.length<=4000);
 await assert.rejects(service.result(session,'different'),/no longer/);const result=await service.result(session,requestId);assert.equal(result.status,'complete');assert.ok(!('actor' in result));assert.ok(!('actor' in await service.result(session,requestId)));
 for(const role of ['staff','manager','chef'])assert.equal(canViewRoute(role,'doogy-insights'),false);assert.equal(canViewRoute('admin','doogy-insights'),true);
});
test('insights UI presents only generated cards with escaped content and source reports',async()=>{
 const {createInsightsUI}=await import('../src/doogy-insights-ui.js');const oldFetch=globalThis.fetch;
 const evidence=insightEvidence(data(),'a');globalThis.fetch=async(_url,options)=>({ok:true,json:async()=>options?.method==='POST'?{status:'generating'}:{status:'complete',evidence,insights:[{title:'<script>unsafe</script>',finding:'Recorded sales',action:'Review menu',priority:'medium',evidence:evidence.facts[0]}]}});
 try{const ui=createInsightsUI({state:()=>({route:'doogy-insights',store:'a'}),render(){},heading:(_g,t,_d,b)=>t+b,btn:t=>t,icon:()=>''});assert.match(ui.page(),/Generate insights/);await ui.generate();const html=ui.page();assert.match(html,/AI-generated/);assert.match(html,/href="#report-sales"/);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);}finally{globalThis.fetch=oldFetch;}
});
