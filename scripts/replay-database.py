#!/usr/bin/env python3
"""Replay into an EMPTY loopback-only Supabase database. Never resets a database."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--psql', required=True, help='Path to a trusted local psql binary')
parser.add_argument('--port', required=True, type=int, help='Port of a disposable local Supabase stack')
parser.add_argument('--report', required=True, type=Path)
args = parser.parse_args()
if not 1024 <= args.port <= 65535:
    parser.error('Use a nonprivileged local test port.')
root = Path(__file__).resolve().parents[1]
base = root / 'supabase'
# Explicit loopback endpoint; do not inherit PGHOST, connection services or production credentials.
env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
env['PGPASSWORD'] = 'postgres'
command = [args.psql, '-h', '127.0.0.1', '-p', str(args.port), '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-At']
def sql(query=None, file=None, transaction=False):
    flags = ['--single-transaction'] if transaction else []
    flags += ['-f', str(file)] if file else ['-c', query]
    result = subprocess.run(command + flags, env=env, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result.stdout.strip()

# Require the Supabase service schemas but no application objects. Never erase existing data.
if sql("select to_regclass('auth.users') is not null and to_regclass('storage.objects') is not null") != 't':
    raise SystemExit('A disposable Supabase stack with Auth and Storage schemas is required.')
if sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','p','v','m')") != '0':
    raise SystemExit('Refusing replay: application objects already exist. Provision a fresh disposable stack.')
manifest = json.loads((base / 'migration-history.json').read_text())
for item in manifest['migrations']:
    if hashlib.sha256((base / 'migrations' / item['file']).read_bytes()).hexdigest() != item['sha256']:
        raise SystemExit('Imported migration changed: ' + item['file'])
report = {'started_at_utc': datetime.now(timezone.utc).isoformat(), 'target': 'loopback disposable Supabase', 'production_modified': False, 'migrations': [], 'status': 'running'}
try:
    sql(file=base / 'bootstrap/initial-schema.sql', transaction=True)
    report['baseline'] = 'passed'
    for migration in sorted((base / 'migrations').glob('*.sql')):
        if migration.name.startswith('20261004123803_'):
            sql(file=base / 'tests/replay-seed.sql', transaction=True)
            report['synthetic_seed'] = 'two records for the historical Fountain Soda prerequisite'
        sql(file=migration, transaction=True)
        report['migrations'].append({'file': migration.name, 'status': 'passed'})
    actual = json.loads(sql(file=base / 'tests/catalog.sql'))
    expected = json.loads((base / 'tests/expected-catalog.json').read_text())
    report['catalog'] = {}
    for key, values in expected.items():
        want = {json.dumps(row, sort_keys=True) for row in values}
        got = {json.dumps(row, sort_keys=True) for row in actual[key]}
        report['catalog'][key] = {'expected': len(want), 'actual': len(got), 'matches': want == got}
        if want != got:
            raise RuntimeError('Catalog mismatch: ' + key)
    sql(file=base / 'tests/access-control.sql')
    report['access_control'] = 'manager store and tenant isolation; admin MFA requirement; anonymous read denied'
    report['status'] = 'passed'
except Exception as error:
    report['status'] = 'failed'
    report['error'] = str(error)
    raise
finally:
    report['finished_at_utc'] = datetime.now(timezone.utc).isoformat()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + '\n')
print(f"Replayed {len(report['migrations'])} migrations; catalog and access checks passed.")
