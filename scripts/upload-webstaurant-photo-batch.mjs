import {readFile,writeFile} from 'node:fs/promises';
import {createPhotoStorage,loadS3Config} from '../server/photo-storage.mjs';
const dir=new URL('../audits/product-photos-webstaurant-2026-10-04/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('mapping.json',dir),'utf8'));
const aliases=Object.fromEntries(manifest.map(x=>[x.itemId,x.id]));
const storage=createPhotoStorage(await loadS3Config(),fetch,aliases);
const results=[];
for(const row of manifest){
 try{
 const body=await readFile(row.file);
 const photo=await storage.save('items',row.itemId,body);
 results.push({...row,...photo,verified:true});
 console.log(`${results.length}/${manifest.length} SKU ${row.sku}: verificado`);
 }catch{results.push({...row,verified:false});console.log(`SKU ${row.sku}: falhou`);}
 await writeFile(new URL('upload-results.json',dir),JSON.stringify(results,null,2));
}
if(results.some(r=>!r.verified))process.exitCode=1;
