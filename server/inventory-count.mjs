import {ApiError} from './auth.mjs';
import {countDatabaseMessage} from './inventory-count-messages.mjs';
export async function saveInventoryDraft(auth,session,body){
 try{return await auth.request('/rest/v1/rpc/save_inventory_count',{token:session.token,method:'POST',body:{p:body}});}
 catch(error){
  const code=error.databaseCode;
  if(code==='40001')throw new ApiError(409,countDatabaseMessage('Count changed in another window. Reopen it from History.'));
  if(code==='P0001'||/^22/.test(code||''))throw new ApiError(422,countDatabaseMessage(error.message)||'Check the count quantities, units and notes. Your saved draft is preserved.');
  throw error;
 }
}
