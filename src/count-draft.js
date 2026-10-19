// Serialize writes so autosave and section submission share one optimistic version.
export function createCountSync({id,locationId,version=0,request,onSaved=()=>{}}){
 let tail=Promise.resolve(),pending=null;
 const send=async body=>{const record=await request(body);version=record.version;pending=null;onSaved(record);return record;};
 return {
  save(state,action='save',section){
   const snapshot=structuredClone(state);
   const work=tail.catch(()=>{}).then(async()=>{
    if(pending){ // Retry the exact request after an ambiguous network failure.
     const retry=pending,result=await send(retry);
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
