import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {access} from 'node:fs/promises';
import {filesUnder} from './lib/files.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const historical = process.argv.includes('--historical');
if (historical) {
  try { await access(new URL('../public/data/snapshot.json', import.meta.url)); await access(new URL('../audits/cloud-integration-2026-10-05/fixtures/', import.meta.url)); }
  catch { console.error('Historical tests require the original private exports in public/data/ and audits/cloud-integration-2026-10-05/fixtures/. They are not included in the repository. No tests were run.'); process.exit(1); }
}
const directory = root + (historical ? 'tests/historical' : 'tests');
const files = (await filesUnder(directory, {exclude: historical ? [] : ['historical', 'fixtures', 'helpers']})).filter(file => file.endsWith('.test.mjs'));
if (!files.length) throw new Error('No test files discovered.');
const result = spawnSync(process.execPath, ['--test', '--test-timeout=15000', ...files], {cwd: root, stdio: 'inherit'});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
