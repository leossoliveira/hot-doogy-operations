// Synthetic latency model, not a production speed guarantee.
import {execFileSync} from 'node:child_process';
import {readTables as after} from '../server/live-data.mjs';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const baseline=process.argv[2];
if(!baseline)throw Error('Usage: node scripts/benchmark-workspace-pipeline.mjs <baseline-git-ref>');
const source=execFileSync('git',['show',baseline+':server/live-data.mjs'],{cwd:root,encoding:'utf8'}).replace(/from '([^']+)'/g,(_,path)=>`from '${new URL(path,pathToFileURL(root+'server/live-data.mjs')).href}'`);
const {readTables:before}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const rows=Array.from({length:3715},(_,i)=>({id:String(i).padStart(6,'0')}));
for(const [version,read] of [['before',before],['after',after]]){
 const durations=[];let calls,peak;
 for(let run=0;run<3;run++){
  calls=0;peak=0;let active=0;const start=performance.now();
  const result=await read({request:async(path,{body})=>{
   calls++;active++;peak=Math.max(peak,active);
   try{
    await new Promise(resolve=>setTimeout(resolve,body?.p_tables?.includes('waste_events')?300:40));
    if(body?.p_tables)return Object.fromEntries(body.p_tables.map(table=>[table,table==='invoice_lines'?rows.slice(0,500):[]]));
    const params=new URL(path,'http://test').searchParams,cursor=params.get('id').slice(3);return rows.filter(row=>row.id>cursor).slice(0,500);
   }finally{active--;}
  }},'synthetic','owner',{batch:true});
  if(JSON.stringify(result.invoice_lines)!==JSON.stringify(rows))throw Error('Incomplete history');durations.push(Math.round(performance.now()-start));
 }
 console.log({version,durations,calls,peak,rows:rows.length});
}
