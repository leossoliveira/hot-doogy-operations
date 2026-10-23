// Reproducible synthetic latency model; counts reflect the October 23 diagnosis.
// No production credentials or business records. Not a production speed claim.
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {readTables as after,TABLES} from '../server/live-data.mjs';
const baseline=process.argv[2];if(!baseline)throw Error('Usage: node scripts/benchmark-workspace-histories.mjs <baseline-ref>');
const root=new URL('../',import.meta.url);
const source=execFileSync('git',['show',baseline+':server/live-data.mjs'],{cwd:root,encoding:'utf8'}).replace(/from '([^']+)'/g,(_,path)=>`from '${new URL(path,new URL('server/live-data.mjs',root)).href}'`);
const {readTables:before}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const counts={sales_item_facts:16050,purchase_order_lines:3735,invoice_lines:3715,inventory_transactions:2445,store_count_observations:1613,stock_count_lines:972,stock_count_line_entries:932,inventory_item_units:605,recipe_components:528};
const rows=Object.fromEntries(TABLES.map(table=>{const count=counts[table]||20;return [table,Array.from({length:count},(_,i)=>({id:`${Math.floor(i/count*0x100000000).toString(16).padStart(8,'0')}-0000-4000-8000-000000000000`,value:i}))];}));
rows.location_settings=rows.location_settings.map(row=>({...row,location_id:row.id}));
for(const [version,read] of [['before',before],['after',after]]){
 const durations=[];let calls,peak;
 for(let run=0;run<3;run++){
  calls=0;peak=0;let active=0;const start=performance.now();
  const result=await read({request:async(path,{body})=>{
   calls++;active++;peak=Math.max(peak,active);
   try{
    let result,cost;
    if(body?.p_tables){result=Object.fromEntries(body.p_tables.map(table=>[table,rows[table].slice(0,table==='sales_item_facts'?1000:500)]));cost=body.p_tables.reduce((sum,table)=>sum+15+result[table].length*.05,0);}
    else if(path.endsWith('/workspace_sales_page')){result=rows.sales_item_facts.filter(row=>(!body.p_after||row.id>body.p_after)&&(!body.p_lower||row.id>=body.p_lower)&&(!body.p_upper||row.id<body.p_upper)).slice(0,body.p_limit);cost=15+result.length*.05;}
    else {const url=new URL(path,'http://test'),table=url.pathname.split('/').at(-1);result=rows[table].filter(row=>url.searchParams.getAll('id').every(filter=>{const [op,value]=filter.split('.');return op==='gt'?row.id>value:op==='gte'?row.id>=value:row.id<value;})).slice(0,Number(url.searchParams.get('limit')));cost=15+result.length*.05;}
    await new Promise(resolve=>setTimeout(resolve,40+cost));return result;
   }finally{active--;}
  }},'synthetic','owner',{batch:true});
  for(const table of TABLES)assert.deepEqual(result[table],rows[table]);durations.push(Math.round(performance.now()-start));
 }
 console.log(JSON.stringify({version,durations,calls,peak,totalRows:Object.values(rows).reduce((sum,values)=>sum+values.length,0)}));
}
