// Serialize writes so autosave and section submission share one optimistic version.
export function createCountSync({id,locationId,version=0,request,onSaved=()=>{}}){
 let tail=Promise.resolve(),pending=null,completed=null;
 const send=async body=>{
  let record;
  try{record=await request(body);}catch(error){
   // A definitive rejection cannot have committed. Do not poison later corrected edits.
   if(error.status>=400&&error.status<500&&![408,429].includes(error.status))pending=null;
   throw error;
  }
  version=record.version;pending=null;if(record.status==='completed')completed=record;
  onSaved(record);return record;
 };
 return {
  save(state,action='save',section){
   const snapshot=structuredClone(state);
   const work=tail.catch(()=>{}).then(async()=>{
    if(completed)return completed;
    if(pending){ // Retry the exact request after an ambiguous network failure.
     const retry=pending,result=await send(retry);
     if(result.status==='completed')return result;
     if(retry.action===action&&retry.section===section&&JSON.stringify(retry.state)===JSON.stringify(snapshot))return result;
    }
    pending={id,locationId,expectedVersion:version,requestId:crypto.randomUUID(),action,state:snapshot,countOffsetMinutes:new Date().getTimezoneOffset(),...(section?{section}:{})};
    return send(pending);
   });
   tail=work;return work;
  },
 };
}
export function sectionIsPublished(lines,published){
 const signature=lines.slice().sort((a,b)=>a.rowId.localeCompare(b.rowId)).map(x=>({itemId:x.itemId,itemUnitId:x.itemUnitId,qty:Number(x.qty||0)}));
 return !!published&&JSON.stringify(signature)===JSON.stringify(published.map(x=>({itemId:x.itemId,itemUnitId:x.itemUnitId,qty:Number(x.qty)})));
}

// A blank is uncounted until the operator explicitly confirms zero stock.
export function countCompletionReview(lines,section){
 const selected=lines.filter(line=>section===undefined||line.section===section);
 const blank=selected.filter(line=>line.qty==null||String(line.qty).trim()==='').length;
 return {total:selected.length,blank,filled:selected.length-blank};
}
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export function countRecovery(saved,cached){
 if(!cached?.state||cached.id!==saved.id||canonical(cached.state)===canonical(saved.state))return {kind:'none'};
 const identity=state=>(state?.lines||[]).map(x=>[x.rowId,x.itemId,x.section]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
 const sameScope=JSON.stringify(identity(saved.state))===JSON.stringify(identity(cached.state));
 return cached.version===saved.version&&sameScope?{kind:'restore',state:cached.state}:{kind:'conflict',copy:cached};
}
