// Synthetic PostgreSQL only: this test has no production credentials or network client.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildSQL, sha256} from '../../scripts/deploy-database.mjs';
const {PGlite} = await import(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const db = new PGlite();
const migration = readFileSync(new URL('../migrations/20261017030012_application_release_versioning.sql', import.meta.url), 'utf8');
await db.exec(`create role anon; create role authenticated; create role service_role;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
  insert into supabase_migrations.schema_migrations values('20261016000000','baseline',array['select 1;']);`);
const remote = (await db.query('select version,name,md5(statements::text) statements_md5 from supabase_migrations.schema_migrations')).rows;
const m1 = {version: '20261017030012', name: 'application_release_versioning', sql: migration, sha256: sha256(migration)};
const m2 = {version: '20261018000000', name: 'synthetic', sql: 'create table public.synthetic_version_test(id integer);', sha256: sha256('create table public.synthetic_version_test(id integer);')};
const plan = {baseline: {remote}, migrations: [m1]};
const options = {mode: 'prepare', version: 'v0.1.100', commit: 'a'.repeat(40)};
const run = (mode, extra = {}, p = plan) => db.exec(buildSQL(p, {...options, mode, ...extra}));
const fails = async fn => { await assert.rejects(fn); await db.exec('rollback;'); };
try {
  await run('prepare');
  await run('prepare');
  assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations')).rows[0].n, 2, 'retry never replays');
  assert.equal((await db.query('select count(*)::int n from deployment.current_release')).rows[0].n, 0, 'prepare is not activation');
  await run('activate');
  assert.equal((await db.query('select version from deployment.current_release')).rows[0].version, options.version);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal((await db.query(`select has_schema_privilege('${role}','deployment','usage') allowed`)).rows[0].allowed, false);
    for (const table of ['current_release', 'release_events', 'migration_checksums']) {
      assert.equal((await db.query(`select has_table_privilege('${role}','deployment.${table}','select') allowed`)).rows[0].allowed, false);
    }
  }
  await fails(() => run('prepare', {commit: 'b'.repeat(40)}));
  await fails(() => run('activate', {version: 'v0.1.101'}));
  await db.exec("update supabase_migrations.schema_migrations set statements=array['changed'] where name='baseline'");
  await fails(() => run('prepare'));
  await db.exec("update supabase_migrations.schema_migrations set statements=array['select 1;'] where name='baseline'");
  await db.exec("insert into supabase_migrations.schema_migrations values('20261019000000','unknown',array['select 1'])");
  await fails(() => run('prepare'));
  await db.exec("delete from supabase_migrations.schema_migrations where name='unknown'");
  const failing = {version:'20261018000001',name:'failure',sql:"select 1/0;",sha256:sha256('select 1/0;')};
  await fails(() => run('prepare', {version:'v0.1.101'}, {...plan,migrations:[m1,m2,failing]}));
  assert.equal((await db.query("select to_regclass('public.synthetic_version_test') t")).rows[0].t, null, 'entire batch rolls back');
  assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations')).rows[0].n, 2);
  await run('prepare', {version:'v0.1.101'}, {...plan,migrations:[m1,m2]});
  await run('rollback', {version:'v0.1.101',previousVersion:'v0.1.100',previousCommit:'a'.repeat(40)}, {...plan,migrations:[m1,m2]});
  assert.equal((await db.query('select version,schema_version from deployment.current_release')).rows[0].version,'v0.1.100');
  assert.equal((await db.query('select version,schema_version from deployment.current_release')).rows[0].schema_version,m2.version,'rollback retains expanded schema');
  await run('failed', {version:'v0.1.101'}, {...plan,migrations:[m1,m2]});
  assert.equal((await db.query('select count(*)::int n from deployment.current_release')).rows[0].n, 0,'no false active state after failed recovery');
  await fails(() => run('prepare', {}, {...plan,migrations:[{...m1,sql:migration+'\n-- changed'}]}));
  console.log('PASS: baseline drift, unknown history, atomic failure, retry, immutable release, prepare/activate/rollback, retained schema and denied API roles.');
} finally { await db.close(); }
