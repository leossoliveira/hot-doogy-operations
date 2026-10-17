import {readFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadPlan} from './deploy-database.mjs';
const base = new URL('../supabase/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('migration-history.json', base), 'utf8'));
const files = (await readdir(new URL('migrations/', base))).filter(name => name.endsWith('.sql'));
const versions = new Set();
for (const file of files) {
  const match = /^(\d{14})_[a-zA-Z0-9_]+\.sql$/.exec(file);
  if (!match || versions.has(match[1])) throw new Error(`Invalid or duplicate migration version: ${file}`);
  versions.add(match[1]);
  if (!(await readFile(new URL('migrations/' + file, base), 'utf8')).trim()) throw new Error(`Empty migration: ${file}`);
}
for (const entry of manifest.migrations) {
  const content = await readFile(new URL('migrations/' + entry.file, base));
  if (createHash('sha256').update(content).digest('hex') !== entry.sha256) throw new Error(`Applied migration was modified: ${entry.file}`);
}
console.log(`Migration filenames verified: ${files.length}; imported checksums verified: ${manifest.migrations.length}. This is not a database replay test.`);
const plan = loadPlan();
console.log(`Deployment baseline verified: ${plan.baseline.local.length} frozen files; ${plan.migrations.length} subsequent migrations.`);
