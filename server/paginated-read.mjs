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

// Keyset pagination avoids scanning and rechecking RLS on every preceding row.
export async function readCursorPages(request,url,{pageSize=250,key='id',signal}={}){
 const rows=[];let cursor;
 for(;;){
  signal?.throwIfAborted();
  const page=await request(`${url}&limit=${pageSize}${cursor===undefined?'':`&${key}=gt.${encodeURIComponent(cursor)}`}`);
  if(!Array.isArray(page))throw Error('Invalid table response.');
  if(page.length&&page.at(-1)[key]==null)throw Error('Missing pagination key.');
  rows.push(...page);
  if(page.length<pageSize)return rows;
  const next=page.at(-1)[key];if(cursor!==undefined&&String(next)<=String(cursor))throw Error('Table pagination did not advance.');cursor=next;
 }
}

// UUID key ranges are disjoint and exhaustive. Unlike offset workers, inserts
// or deletes before a page cannot shift later pages or silently drop history.
// The caller's scheduler still bounds both per-workspace and process-wide I/O.
export async function readUuidPages(request,url,{pageSize=1000,signal}={}){
 signal?.throwIfAborted();
 const first=await request(`${url}&limit=${pageSize}`);
 if(!Array.isArray(first))throw Error('Invalid table response.');
 const cursor=first.at(-1)?.id;
 if(first.length&&!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(cursor||''))throw Error('Missing UUID pagination key.');
 if(first.length<pageSize)return first;
 const bounds=['00000000-0000-0000-0000-000000000000','40000000-0000-0000-0000-000000000000','80000000-0000-0000-0000-000000000000','c0000000-0000-0000-0000-000000000000'];
 const pages=await Promise.all(bounds.map((lower,i)=>{
  const upper=bounds[i+1];if(upper&&upper<=cursor)return [];
  return readCursorPages(request,`${url}&id=gt.${cursor}&id=gte.${lower}${upper?'&id=lt.'+upper:''}`,{pageSize,signal});
 }));
 return first.concat(...pages);
}
