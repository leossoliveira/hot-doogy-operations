// Bounded concurrency preserves ordering and the caller's authenticated RLS scope.
export function scheduleReads(request,concurrency=8){
 let active=0;const waiting=[];
 function drain(){while(active<concurrency&&waiting.length){const {args,resolve,reject}=waiting.shift();active++;Promise.resolve().then(()=>request(...args)).then(resolve,reject).finally(()=>{active--;drain();});}}
 return (...args)=>new Promise((resolve,reject)=>{waiting.push({args,resolve,reject});drain();});
}

export async function readPages(request,url,{pageSize=1000,concurrency=4}={}){
 const first=await request(`${url}&limit=${pageSize}&offset=0`);
 if(first.length<pageSize)return first;
 const pages=new Map([[0,first]]);let next=pageSize,end=Infinity;
 await Promise.all(Array.from({length:concurrency},async()=>{
  while(next<end){const offset=next;next+=pageSize;const page=await request(`${url}&limit=${pageSize}&offset=${offset}`);pages.set(offset,page);if(page.length<pageSize)end=Math.min(end,offset+page.length);}
 }));
 return [...pages].sort((a,b)=>a[0]-b[0]).filter(([offset])=>offset<end).flatMap(([,page])=>page);
}
