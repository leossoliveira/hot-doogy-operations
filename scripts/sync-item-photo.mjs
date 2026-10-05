import {readFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {createPhotoStorage,loadS3Config} from '../server/photo-storage.mjs';
const {values}=parseArgs({options:{item:{type:'string'},file:{type:'string'}}});
try{
 const snapshot=JSON.parse(await readFile(new URL('../public/data/snapshot.json',import.meta.url),'utf8'));
 if(!snapshot.items.some(i=>i.id===values.item))throw Error('Unknown item');
 const catalog=JSON.parse(await readFile(new URL('../public/data/supplier-catalog.json',import.meta.url),'utf8'));
 const aliases=Object.fromEntries([...catalog.items].sort((a,b)=>b.supplierItemId.localeCompare(a.supplierItemId)).map(x=>[x.itemId,x.supplierItemId]));
 const storage=createPhotoStorage(await loadS3Config(),fetch,aliases);
 const photo=await storage.save('items',values.item,await readFile(values.file));
 console.log(JSON.stringify({bucket:'supplier-item-images',...photo,verifiedVia:'S3 GET + SHA-256'}));
}catch{console.error('Upload ou verificação no Storage falhou. Nenhuma credencial exibida.');process.exitCode=1;}
