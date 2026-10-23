// Interactive reads take priority. A bounded calculation page runs only while
// the read queue is idle. Limit concurrent work on the Micro database. Heavy calculations stay exclusive.
// Values are never cached/shared: every request keeps its caller's token/RLS.
export const READ_CONCURRENCY=[1,2,3,4].includes(Number(process.env.HOT_DOOGY_READ_CONCURRENCY))?Number(process.env.HOT_DOOGY_READ_CONCURRENCY):4;
export function createReadBudget(concurrency=READ_CONCURRENCY,{maxQueue=128,maxWaitMs=15000,now=Date.now}={}){
 let active=0,calculating=false;const reads=[],calculations=[];
 function start(entry,calculation){
  if(now()-entry.queuedAt>=maxWaitMs){entry.reject(busyError());return;}
  if(calculation)calculating=true;else active++;
  Promise.resolve().then(entry.run).then(entry.resolve,entry.reject).finally(()=>{if(calculation)calculating=false;else active--;drain();});
 }
 function drain(){
  if(calculating)return;
  while(active<concurrency&&reads.length)start(reads.shift(),false);
  while(!active&&!reads.length&&!calculating&&calculations.length)start(calculations.shift(),true);
 }
 const busyError=()=>Object.assign(Error('The database is busy. Please retry shortly.'),{status:503});
 const enqueue=(queue,run)=>new Promise((resolve,reject)=>{
  if(reads.length+calculations.length>=maxQueue){reject(busyError());return;}
  queue.push({run,resolve,reject,queuedAt:now()});drain();
 });
 return {read:run=>enqueue(reads,run),calculate:run=>enqueue(calculations,run)};
}
const budget=createReadBudget();
export const bulkRead=run=>budget.read(run);
export const calculationRead=run=>budget.calculate(run);

// Only a confirmed database timeout can shrink/retry a read-only calculation.
// Every retry uses the same offset; successful rows are never double-counted.
export async function readCalculationPage(run,limit=25){
 for(;;){
  try{return {value:await calculationRead(()=>run(limit)),limit};}
  catch(error){if(error.databaseCode!=='57014'||limit===1)throw error;limit=Math.max(1,Math.floor(limit/2));}
 }
}
