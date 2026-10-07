#!/usr/bin/env python3
"""Restore into a NEW loopback-only native Supabase database; never reset a DB."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from datetime import datetime, timezone


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pg-bin', required=True, type=Path)
    parser.add_argument('--port', required=True, type=int)
    parser.add_argument('--artifacts', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error('Expected a local unprivileged port')
    os.umask(0o077)
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    env.update(PGHOST='127.0.0.1', PGPORT=str(args.port), PGUSER='supabase_admin',
               PGPASSWORD='postgres', PGDATABASE='postgres', PGCONNECT_TIMEOUT='10')
    base = [str(args.pg_bin / 'psql'), '-X', '-v', 'ON_ERROR_STOP=1', '-At']
    def query(sql):
        result = subprocess.run(base + ['-c', sql], env=env, capture_output=True, text=True,
                                timeout=300)
        if result.returncode:
            raise RuntimeError('Isolated SQL verification failed')
        return result.stdout
    artifacts = args.artifacts.resolve()
    manifest = json.loads((artifacts / 'manifest.json').read_text())
    for name in ['database.dump', 'roles.sql', 'row-counts.json']:
        if hashlib.sha256((artifacts / name).read_bytes()).hexdigest() != manifest['files'][name]:
            raise ValueError('Artifact checksum mismatch')
    existing = query('select rolname from pg_roles;').splitlines()
    for role in re.findall(r'^CREATE ROLE (\w+);$', (artifacts / 'roles.sql').read_text(), re.M):
        if role not in existing:
            query(f'CREATE ROLE "{role}" NOLOGIN;')
    database = 'backup_drill_' + datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
    query(f'CREATE DATABASE "{database}" TEMPLATE template0;')
    log = args.report.with_suffix('.private.log')
    with log.open('wb') as output:
        result = subprocess.run([str(args.pg_bin / 'pg_restore'), '--exit-on-error',
                                 '--dbname=' + database, str(artifacts / 'database.dump')],
                                env=env, stdout=output, stderr=output, timeout=1800)
    if result.returncode:
        raise RuntimeError('SQL restore failed; see private log')
    env['PGDATABASE'] = database
    expected = json.loads((artifacts / 'row-counts.json').read_text())
    qi = lambda s: '"' + s.replace('"', '""') + '"'
    ql = lambda s: "'" + s.replace("'", "''") + "'"
    statements = [f"select json_build_object('schema',{ql(x['schema'])},'table',"
                  f"{ql(x['table'])},'rows',count(*)) from only {qi(x['schema'])}.{qi(x['table'])}"
                  for x in expected]
    actual = [json.loads(line) for line in query(' union all '.join(statements) + ';').splitlines()]
    key = lambda x: (x['schema'], x['table'])
    if sorted(actual, key=key) != sorted(expected, key=key):
        raise ValueError('Restored table counts differ')
    access = Path(__file__).resolve().parents[2] / 'supabase/tests/access-control.sql'
    with log.open('ab') as output:
        result = subprocess.run(base + ['-f', str(access)], env=env, stdout=output,
                                stderr=output, timeout=300)
    if result.returncode:
        raise RuntimeError('Restored access-control checks failed; see private log')
    report = {'completed_at': datetime.now(timezone.utc).isoformat(), 'status': 'passed',
              'database': database, 'tables': len(actual), 'rows': sum(x['rows'] for x in actual),
              'access_control': 'passed', 'scope': 'SQL restore and row counts; APIs disabled'}
    args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
