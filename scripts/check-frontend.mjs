import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
// Deployment needs no build tool or network dependency installation.
const {files}=JSON.parse(await readFile('frontend-manifest.json','utf8'));
for(const [file,expected] of Object.entries(files)){
 const actual=createHash('sha256').update(await readFile(file)).digest('hex');
 if(actual!==expected)throw Error(`Frontend bundle is stale: ${file}. Run npm run build and commit the outputs.`);
}
const html=await readFile('index.html','utf8');
if(!html.includes('/src/app.bundle.js')||!html.includes('/src/app.bundle.css'))throw Error('Startup must use the frontend bundles.');
console.log('Frontend bundle matches its sources.');
