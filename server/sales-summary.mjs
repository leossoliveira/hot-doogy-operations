import {calculationRead} from './read-budget.mjs';
import {purchasingSales} from './purchasing-sales.mjs';
import {createHash} from 'node:crypto';
export function salesSignature(raw){return createHash('sha256').update(JSON.stringify(Object.fromEntries(['inventory_items','menu_items','sales_import_batches','locations','recipes','recipe_versions','recipe_components','inventory_item_units','menu_item_modifier_rules','modifiers','sales_item_facts'].map(k=>[k,raw[k]])))).digest('hex');}
export async function salesSummary(auth,session,raw){
 const signature=salesSignature(raw);
 if(session.salesSummary?.signature===signature)return session.salesSummary.result;
 const rows=new Map(),itemRows=new Map(),days=new Map(),issues=new Map();let offset=0,fullUsageAvailable=true;
 const total=raw.sales_item_facts.filter(r=>r.source_row_id).length;
 while(offset<total){const start=offset;offset+=50;const part=await calculationRead(()=>auth.request('/rest/v1/rpc/operations_preparation_sales',{token:session.token,method:'POST',body:{p_offset:start,p_limit:50}}));
 if(!Array.isArray(part.itemRows))fullUsageAvailable=false;
 for(const x of part.itemRows||[]){const k=[x.date,x.locationId,x.itemId].join('|'),old=itemRows.get(k);if(old)old.baseQty+=Number(x.baseQty);else itemRows.set(k,{...x,baseQty:Number(x.baseQty)});}
 for(const x of part.rows){const k=[x.date,x.locationId,x.itemId].join('|'),old=rows.get(k);if(old)old.baseQty+=Number(x.baseQty);else rows.set(k,{...x,baseQty:Number(x.baseQty)});}
 for(const x of part.days){const k=x.date+'|'+x.locationId,old=days.get(k);if(old){old.totalLines+=x.totalLines;old.incompleteLines+=x.incompleteLines;}else days.set(k,{...x});}
 for(const x of part.issues){const k=x.code+'|'+x.locationId,old=issues.get(k);if(old)old.occurrences+=x.occurrences;else issues.set(k,{...x});}
 }
 const result={meta:{extractedAt:new Date().toISOString(),source:'Supabase recipe calculation'},rows:[...rows.values()],days:[...days.values()],issues:[...issues.values()]};result.purchasingSales=purchasingSales({...result,itemRows:fullUsageAvailable?[...itemRows.values()]:null},raw);session.salesSummary={signature,result};return result;
}

// Keep slow recipe calculations outside the initial workspace request.
export function queueSalesSummary(auth,session,raw,{calculate=salesSummary,now=Date.now,start=true}={}){
 const signature=salesSignature(raw);
 if(session.salesSummary?.signature===signature)return {status:'ready',result:session.salesSummary.result};
 if(!start)return {status:session.salesJob?'loading':'idle',result:null};
 if(session.salesJob)return {status:'loading',result:null};
 if(session.salesFailure?.signature===signature&&now()<session.salesFailure.retryAt)return {status:'error',result:null};
 session.salesJob=Promise.resolve().then(()=>calculate(auth,session,raw)).then(()=>{session.salesFailure=null;}).catch(()=>{session.salesFailure={signature,retryAt:now()+300000};}).finally(()=>{session.salesJob=null;});
 return {status:'loading',result:null};
}
