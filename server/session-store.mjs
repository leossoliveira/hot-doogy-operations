import {mkdirSync,readFileSync,writeFileSync,renameSync,chmodSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';

// One application process owns this directory, outside versioned release folders.
// Only MFA-verified sessions survive a restart. Pending enrollment secrets never do.
export function createSessionStore(directory,{now=Date.now,maxAge=30*24*60*60*1000}={}){
 const sessions=new Map();
 if(!directory)return {sessions,save(){}};
 mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
 const keyPath=join(directory,'key'),file=join(directory,'sessions.enc');
 let key;
 try{key=readFileSync(keyPath);}catch(error){if(error.code!=='ENOENT')throw error;key=randomBytes(32);writeFileSync(keyPath,key,{flag:'wx',mode:0o600});}
 if(key.length!==32)throw Error('Invalid session encryption key.');chmodSync(keyPath,0o600);
 try{
  const bytes=readFileSync(file),decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));
  const rows=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
  if(!Array.isArray(rows)||rows.length>10000)throw Error('Invalid session store.');
  for(const [id,s] of rows)if(/^[a-f0-9]{64}$/.test(id)&&Number.isFinite(s.verifiedAt)&&s.verifiedAt<=now()&&now()-s.verifiedAt<maxAge&&s.token&&s.refresh&&s.user?.id)sessions.set(id,s);
 }catch(error){if(error.code!=='ENOENT')throw Error('Unable to read encrypted session store.',{cause:error});}
 let lastSaved;
 function save(){
  const rows=[];
  for(const [id,s] of sessions){if(!Number.isFinite(s.verifiedAt)||s.pending||now()-s.verifiedAt>=maxAge)continue;
   const {createdAt,verifiedAt,user,token,refresh,expiresAt}=s;rows.push([id,{createdAt,verifiedAt,user,token,refresh,expiresAt}]);
  }
  const serialized=JSON.stringify(rows);if(serialized===lastSaved)return;
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),encrypted=Buffer.concat([cipher.update(serialized,'utf8'),cipher.final()]);
  const tmp=file+'.'+randomBytes(8).toString('hex');
  try{writeFileSync(tmp,Buffer.concat([iv,cipher.getAuthTag(),encrypted]),{flag:'wx',mode:0o600});renameSync(tmp,file);lastSaved=serialized;}finally{try{unlinkSync(tmp);}catch(error){if(error.code!=='ENOENT')throw error;}}
 }
 return {sessions,save};
}
