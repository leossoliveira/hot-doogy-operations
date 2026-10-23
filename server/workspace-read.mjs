import {readTables} from './live-data.mjs';
// Share only in-flight reads within the same authenticated session/generation.
// Successful writes invalidate the generation; no cross-user or stale cache.
export function createWorkspaceReader({read=(auth,token,role)=>readTables(auth,token,role,{batch:true}),now=Date.now,retryDelayMs=30000}={}){
 const states=new WeakMap();
 function state(session){let value=states.get(session);if(!value){value={generation:0};states.set(session,value);}return value;}
 return {
  invalidate(session){const value=state(session);value.generation++;},
  read(auth,session){const value=state(session),key=[session.token,session.member.role,value.generation].join('|');if(value.pending?.key===key)return value.pending.promise;
   // A save makes the old result obsolete, but must not overlap its full scan.
   // All waiters join one fresh read of the latest generation when it finishes.
   if(value.pending)return value.pending.promise.catch(()=>{}).then(()=>this.read(auth,session));
   if(value.failure&&now()<value.failure.retryAt)return Promise.reject(value.failure.error);
   const entry={key};entry.promise=Promise.resolve().then(()=>read(auth,session.token,session.member.role)).then(result=>{value.failure=null;return result;},error=>{
    // Repeated refreshes during overload must not launch another full scan.
    // Cache only a transient failure, never rows or authorization decisions.
    if(error.status===503)value.failure={error,retryAt:now()+retryDelayMs};throw error;
   }).finally(()=>{if(value.pending===entry)value.pending=null;});value.pending=entry;return entry.promise;
  }
 };
}
