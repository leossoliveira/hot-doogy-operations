// Interactive reads take priority. A bounded calculation page runs only while
// the read queue is idle, so it cannot compete with eight list queries at once.
// Values are never cached/shared: every request keeps its caller's token/RLS.
export function createReadBudget(concurrency=8){
 let active=0,calculating=false;const reads=[],calculations=[];
 function start(entry,calculation){
  if(calculation)calculating=true;else active++;
  Promise.resolve().then(entry.run).then(entry.resolve,entry.reject).finally(()=>{if(calculation)calculating=false;else active--;drain();});
 }
 function drain(){
  if(calculating)return;
  while(active<concurrency&&reads.length)start(reads.shift(),false);
  if(!active&&!reads.length&&calculations.length)start(calculations.shift(),true);
 }
 const enqueue=(queue,run)=>new Promise((resolve,reject)=>{queue.push({run,resolve,reject});drain();});
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
