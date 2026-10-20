// Allow accepted requests to finish before systemd replaces the process.
export function drainServer(server,{timeout=17000,onDrained=()=>process.exit(0)}={}){
 let closing=false;
 return ()=>{if(closing)return;closing=true;const timer=setTimeout(()=>{server.closeAllConnections?.();onDrained();},timeout);timer.unref?.();server.close(()=>{clearTimeout(timer);onDrained();});server.closeIdleConnections?.();};
}
