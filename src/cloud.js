export async function api(path,body){const r=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(45000),...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const value=await r.json();if(!r.ok){const e=Error(value.error||"Unable to sync.");e.status=r.status;throw e;}return value;}
export const command=(action,payload,commandId=crypto.randomUUID())=>api('/api/command',{action,payload,commandId});
let commit=async()=>{throw Error("Sign in to save to the database.");};
export function configureCommit(fn){commit=fn;}
export const saveCloudState=state=>commit(state);
export function createRefreshLoop({refresh,canRefresh,onError,interval=30000,target=window}){let busy=false,stopped=false;async function tick(){if(stopped||busy||!canRefresh())return;busy=true;try{await refresh();}catch(e){onError(e);}finally{busy=false;}}const timer=setInterval(tick,interval);target.addEventListener('online',tick);target.addEventListener('focus',tick);return {tick,stop(){stopped=true;clearInterval(timer);target.removeEventListener('online',tick);target.removeEventListener('focus',tick);}};}
