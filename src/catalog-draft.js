// Drafts contain form fields only, never authentication credentials.
export function createCatalogDraft({storage,key,now=Date.now,uuid=()=>crypto.randomUUID()}){
 let value;
 try{const saved=JSON.parse(storage?.getItem(key)||'null');if(saved?.id&&Array.isArray(saved.fields)&&Number.isFinite(saved.updatedAt)&&(saved.pending||now()-saved.updatedAt<7*86400000))value=saved;}catch{}
 value ||= {id:uuid(),fields:[],pending:null};
 function persist(){value.updatedAt=now();try{if(!storage)throw Error();storage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
 return {
  get value(){return structuredClone(value);},
  capture(fields){if(!value.pending)value.fields=fields;return persist();},
  prepare(kind,payload){value.pending ||= {kind,payload,commandId:value.id};persist();return structuredClone(value.pending);},
  rejected(){value.pending=null;return persist();},
  complete(){try{const current=JSON.parse(storage?.getItem(key)||'null');if(current?.id===value.id)storage.removeItem(key);}catch{}},
 };
}
