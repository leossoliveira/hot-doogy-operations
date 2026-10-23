let onWrite=()=>{};
export function configureWriteObserver(fn){onWrite=fn;}
export async function api(path,body){
 let r,value;
 try{
  r=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(45000),...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  value=await r.json();
 }catch(cause){
  const error=Error((body===undefined||path.startsWith('/api/auth/'))?'Connection interrupted. Please try again.':'The save could not be confirmed. Keep this form open and retry when the connection returns.');
  error.status=r?.ok===false?r.status:503;error.rejected=false;if(cause?.name==='TimeoutError')error.name='TimeoutError';throw error;
 }
 if(!r.ok){const error=Error(value.error||'The service is temporarily unavailable. Please try again.');error.status=r.status;error.code=value.code;error.rejected=value.rejected===true||[400,401,403,409,422].includes(r.status);throw error;}
 if(body!==undefined&&!path.startsWith('/api/auth/'))onWrite(path,body);
 return value;
}
export const command=(action,payload,commandId=crypto.randomUUID())=>api('/api/command',{action,payload,commandId});
let commit=async()=>{throw Error("Sign in to save to the database.");};
export function configureCommit(fn){commit=fn;}
export const saveCloudState=(state,options)=>commit(state,options);
// Schedule refresh after the save handler can close its form and the browser
// can paint. Several notifications in the same burst need only one refresh.
export function createDeferredRefresh({run,schedule=fn=>setTimeout(fn,100)}){
 let pending=false,latest;
 return value=>{latest=value;if(pending)return;pending=true;schedule(()=>{pending=false;run(latest);});};
}
export function createRefreshLoop({refresh,canRefresh,onError,interval=30000,target=window,now=Date.now}){
 let busy=false,stopped=false,nextAt=0,failures=0;
 async function tick(){
  if(stopped||busy||now()<nextAt||!canRefresh())return;
  busy=true;
  try{await refresh();failures=0;}
  catch(e){failures=Math.min(failures+1,4);onError(e);}
  finally{nextAt=now()+Math.min(interval*2**failures,Math.max(interval,300000));busy=false;}
 }
 const timer=setInterval(tick,interval);target.addEventListener('online',tick);target.addEventListener('focus',tick);
 return {tick,stop(){stopped=true;clearInterval(timer);target.removeEventListener('online',tick);target.removeEventListener('focus',tick);}};
}
