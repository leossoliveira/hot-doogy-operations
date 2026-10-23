import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const css=['tokens','styles','login','recipe-detail','date-picker','location-picker','responsive','reports','my-day','careers','a11y'].map(name=>`src/${name}.css`);
// Keep the output next to sources: PDF worker/font URLs remain relative to /src/.
// Large PDF libraries stay lazy and external, rather than bloating startup.
const result=await build({entryPoints:['src/app.js'],outfile:'src/app.bundle.js',bundle:true,format:'esm',target:'es2022',minify:true,metafile:true,external:['./vendor/pdfjs/*','./vendor/pdf-lib.esm.min.js'],legalComments:'eof'});
await writeFile('src/app.bundle.css',(await Promise.all(css.map(file=>readFile(file,'utf8')))).join('\n'));
const paths=[...new Set([...Object.keys(result.metafile.inputs),...css,'scripts/build-frontend.mjs','src/app.bundle.js','src/app.bundle.css'])].sort();
const files=Object.fromEntries(await Promise.all(paths.map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])));
await writeFile('frontend-manifest.json',JSON.stringify({files},null,2)+'\n');
console.log(`Bundled ${Object.keys(result.metafile.inputs).length} JavaScript modules and ${css.length} stylesheets.`);
