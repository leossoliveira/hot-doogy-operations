import {readFileSync, readdirSync, statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
export const sha256 = value => createHash('sha256').update(value).digest('hex');
// E-strings make quoting independent of standard_conforming_strings.
const literal = value => "E'" + String(value).replaceAll('\\', '\\\\').replaceAll("'", "''") + "'";
const block = body => `DO ${literal(`BEGIN\n${body}\nEND`)};`;

export function loadPlan(base = root) {
  const baseline = JSON.parse(readFileSync(path.join(base, 'supabase/deployment-baseline.json'), 'utf8'));
  const directory = path.join(base, 'supabase/migrations');
  const files = readdirSync(directory).filter(name => name.endsWith('.sql')).sort();
  const archived = new Map(baseline.local.map(entry => [entry.file, entry.sha256]));
  for (const [file, checksum] of archived) {
    if (!files.includes(file) || sha256(readFileSync(path.join(directory, file))) !== checksum) {
      throw new Error(`Frozen migration changed or missing: ${file}`);
    }
  }
  const migrations = files.filter(file => !archived.has(file)).map(file => {
    const match = /^(\d{14})_([a-zA-Z0-9_]+)\.sql$/.exec(file);
    if (!match || match[1] <= baseline.cutoff) throw new Error(`New migration must follow baseline: ${file}`);
    const sql = readFileSync(path.join(directory, file), 'utf8');
    if (!sql.trim()) throw new Error(`Empty migration: ${file}`);
    return {version: match[1], name: match[2], sql, sha256: sha256(sql)};
  });
  if (new Set(migrations.map(m => m.version)).size !== migrations.length) throw new Error('Duplicate migration version');
  return {baseline, migrations};
}

export function buildSQL(plan, {mode, version, commit, previousVersion, previousCommit}) {
  if (!['prepare', 'activate', 'failed', 'rollback'].includes(mode)) throw new Error('Invalid deployment mode');
  if (!/^v0\.1\.\d+$/.test(version) || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid release identity');
  if (mode === 'rollback' && (!/^v0\.1\.\d+$/.test(previousVersion || '') || !/^[a-f0-9]{40}$/.test(previousCommit || ''))) {
    throw new Error('Rollback requires the previous deployed version and SHA');
  }
  const {baseline, migrations} = plan;
  const schemaVersion = [...baseline.remote, ...migrations].map(entry => entry.version).sort().at(-1);
  const identity = `environment='production' AND version=${literal(version)} AND commit_sha=${literal(commit)}`;
  const lines = ["BEGIN; SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='120s';",
    "SELECT pg_advisory_xact_lock(207016, 1);"];
  if (mode === 'prepare') {
    const expected = literal(JSON.stringify(baseline.remote));
    const allowed = literal(JSON.stringify(migrations.map(m => ({version: m.version, name: m.name}))));
    lines.push(block(`
      IF EXISTS (
        SELECT 1 FROM jsonb_to_recordset(${expected}::jsonb) AS b(version text, name text, statements_md5 text)
        LEFT JOIN supabase_migrations.schema_migrations m USING(version)
        WHERE m.version IS NULL OR m.name IS DISTINCT FROM b.name OR md5(m.statements::text) IS DISTINCT FROM b.statements_md5
      ) THEN RAISE EXCEPTION 'Remote baseline changed; manual reconciliation required'; END IF;
      IF EXISTS (
        SELECT 1 FROM supabase_migrations.schema_migrations m
        WHERE NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(${expected}::jsonb) AS b(version text) WHERE b.version=m.version)
          AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(${allowed}::jsonb) AS n(version text) WHERE n.version=m.version)
      ) THEN RAISE EXCEPTION 'Unknown remote migration; manual reconciliation required'; END IF;`));
    for (const migration of migrations) {
      const v = literal(migration.version), sql = literal(migration.sql), name = literal(migration.name);
      lines.push(block(`
        IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${v}) THEN
          IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${v}
            AND name=${name} AND statements=ARRAY[${sql}]::text[]) THEN
            RAISE EXCEPTION 'Applied migration content differs: ${migration.version}';
          END IF;
        ELSE
          IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version > ${v}) THEN
            RAISE EXCEPTION 'Out-of-order migration: ${migration.version}';
          END IF;
          EXECUTE ${sql};
          INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES (${v}, ${name}, ARRAY[${sql}]);
        END IF;`));
    }
    for (const m of migrations) lines.push(block(`
      IF EXISTS (SELECT 1 FROM deployment.migration_checksums WHERE version=${literal(m.version)} AND sha256<>${literal(m.sha256)}) THEN
        RAISE EXCEPTION 'Migration checksum changed: ${m.version}';
      END IF;
      INSERT INTO deployment.migration_checksums(version, sha256) VALUES (${literal(m.version)}, ${literal(m.sha256)}) ON CONFLICT DO NOTHING;`));
  }
  lines.push(block(`IF EXISTS (SELECT 1 FROM deployment.release_events WHERE version=${literal(version)} AND commit_sha<>${literal(commit)}) THEN
    RAISE EXCEPTION 'Release tag points to a different commit'; END IF;`));
  if (mode !== 'prepare') lines.push(block(`IF NOT EXISTS (SELECT 1 FROM deployment.release_events WHERE ${identity} AND event='prepared') THEN
    RAISE EXCEPTION 'Release has not been prepared'; END IF;`));
  const event = {prepare: 'prepared', activate: 'active', failed: 'failed', rollback: 'rolled_back'}[mode];
  lines.push(`INSERT INTO deployment.release_events(environment,version,commit_sha,event,schema_version)
    VALUES ('production',${literal(version)},${literal(commit)},${literal(event)},${literal(schemaVersion)});`);
  if (mode === 'activate' || mode === 'rollback') {
    const activeVersion = mode === 'activate' ? version : previousVersion;
    const activeCommit = mode === 'activate' ? commit : previousCommit;
    lines.push(`INSERT INTO deployment.current_release(environment,version,commit_sha,schema_version)
      VALUES ('production',${literal(activeVersion)},${literal(activeCommit)},${literal(schemaVersion)})
      ON CONFLICT(environment) DO UPDATE SET version=excluded.version,commit_sha=excluded.commit_sha,
        schema_version=excluded.schema_version,activated_at=now();`);
  } else if (mode === 'failed') lines.push("DELETE FROM deployment.current_release WHERE environment='production';");
  lines.push('COMMIT;');
  return lines.join('\n');
}

export function executeSQL(sql, configFile, {spawn = spawnSync} = {}) {
  const info = statSync(configFile);
  if (info.mode & 0o077) throw new Error('Database deployment config must have mode 0600');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  if (config.project_id !== 'kfnsfnytnnpwptklmbip' || !config.host?.endsWith('.supabase.com') ||
    config.user !== 'postgres.kfnsfnytnnpwptklmbip' || !config.sslrootcert || !config.pgpassfile) {
    throw new Error('Invalid deployment database config');
  }
  const env = {PATH: process.env.PATH, PGHOST: config.host, PGPORT: String(config.port || 5432),
    PGUSER: config.user, PGDATABASE: 'postgres', PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: config.sslrootcert, PGPASSFILE: config.pgpassfile, PGCONNECT_TIMEOUT: '10'};
  // SQL only goes to stdin, never to argv/logs. Do not echo psql errors (they can contain migration data).
  const result = spawn('/usr/bin/psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1'], {env, input: sql, encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024});
  if (result.error || result.status !== 0) throw new Error('Database deployment failed; application activation blocked. Check history and connection privately.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, version, commit, previousVersion, previousCommit] = process.argv.slice(2);
    const plan = loadPlan();
    const sql = buildSQL(plan, {mode, version, commit, previousVersion, previousCommit});
    executeSQL(sql, process.env.HOT_DOOGY_DATABASE_CONFIG || '/etc/hot-doogy/database-deploy.json');
    console.log(`Database release ${mode}: ${version} (${commit})`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
