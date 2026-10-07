import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {filesUnder} from './lib/files.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const discovered = await filesUnder(root, {exclude: ['.git', 'node_modules', 'vendor', 'public', 'audits', 'output', '__pycache__']});
const files = discovered.filter(file => /\.(mjs|js)$/.test(file));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {stdio: 'inherit'});
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked: ${files.length} JavaScript files.`);
for (const [extension, command, args] of [
  ['.py', 'python3', ['-B', '-c', 'import ast,sys; from pathlib import Path; ast.parse(Path(sys.argv[1]).read_text(), filename=sys.argv[1])']],
  ['.sh', 'bash', ['-n']],
]) {
  const selected = discovered.filter(file => file.endsWith(extension));
  for (const file of selected) {
    const result = spawnSync(command, [...args, file], {stdio: 'inherit'});
    if (result.error) console.error(result.error.message);
    if (result.error || result.status !== 0) process.exit(result.status || 1);
  }
  console.log(`Syntax checked: ${selected.length} ${extension} files.`);
}
