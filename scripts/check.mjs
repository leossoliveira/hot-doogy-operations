import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {filesUnder} from './lib/files.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const files = (await filesUnder(root, {exclude: ['.git', 'node_modules', 'vendor', 'public', 'audits', 'output']})).filter(file => /\.(mjs|js)$/.test(file));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {stdio: 'inherit'});
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked: ${files.length} JavaScript files.`);
