import {readCalculationPage} from './read-budget.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Advance by confirmed progress, never by the requested capacity. A time-bounded
// page can be short even while there is more history to process.
export async function* preparationPages(auth,session,route,scope={}){
 let after=null,signature=null,pageSize=250;
 for(;;){
  const {value:part,limit}=await readCalculationPage(size=>auth.request('/rest/v1/rpc/'+route,
   {token:session.token,method:'POST',body:{...scope,p_after:after,p_limit:size,p_signature:signature}}),pageSize);
  const meta=part?.meta;
  if(!meta||!Number.isInteger(meta.processed)||meta.processed<0||meta.processed>limit||typeof meta.hasMore!=='boolean'
   ||typeof meta.catalogSignature!=='string'||!meta.catalogSignature||(signature&&meta.catalogSignature!==signature)
   ||!['rows','itemRows','days','issues'].every(key=>Array.isArray(part[key]))
   ||(meta.processed>0&&(!uuid.test(meta.nextCursor||'')||(after&&meta.nextCursor<=after)))
   ||(meta.hasMore&&meta.processed===0)||part.days.reduce((n,x)=>n+x.totalLines,0)!==meta.processed)throw Error('Incomplete sales response.');
  yield part;
  if(!meta.hasMore)return;
  after=meta.nextCursor;signature=meta.catalogSignature;pageSize=limit;
 }
}
