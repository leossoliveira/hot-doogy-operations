import {readTables} from './live-data.mjs';
// Share only in-flight reads within the same authenticated session/generation.
// Successful writes invalidate the generation; no cross-user or stale cache.
export function createWorkspaceReader({read=readTables}={}){
 const states=new WeakMap();
 function state(session){let value=states.get(session);if(!value){value={generation:0};states.set(session,value);}return value;}
 return {
  invalidate(session){const value=state(session);value.generation++;value.pending=null;},
  read(auth,session){const value=state(session),key=[session.token,session.member.role,value.generation].join('|');if(value.pending?.key===key)return value.pending.promise;
   const entry={key};entry.promise=Promise.resolve().then(()=>read(auth,session.token,session.member.role)).finally(()=>{if(value.pending===entry)value.pending=null;});value.pending=entry;return entry.promise;
  }
 };
}
