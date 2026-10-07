#!/usr/bin/env python3
"""Consistent, read-only PostgreSQL archive with per-table recovery evidence."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

HOST = 'aws-0-us-west-2.pooler.supabase.com'
USER = 'postgres.kfnsfnytnnpwptklmbip'
PG_BIN = '/usr/lib/postgresql/17/bin'


def export(destination):
    import psycopg2
    from psycopg2 import sql
    destination = Path(destination)
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    env.update(PGHOST=HOST, PGPORT='5432', PGDATABASE='postgres', PGUSER=USER,
               PGPASSFILE='/etc/hot-doogy-backup/postgres.pgpass',
               PGSSLMODE='verify-full', PGSSLROOTCERT='/etc/hot-doogy-backup/supabase-ca.crt',
               PGCONNECT_TIMEOUT='20', PGOPTIONS='-c default_transaction_read_only=on')
    connection = psycopg2.connect(host=HOST, port=5432, dbname='postgres', user=USER,
                                 passfile=env['PGPASSFILE'], sslmode='verify-full',
                                 sslrootcert=env['PGSSLROOTCERT'], connect_timeout=20)
    try:
        connection.set_session(isolation_level='REPEATABLE READ', readonly=True)
        with connection.cursor() as cursor:
            cursor.execute('SELECT pg_export_snapshot()')
            snapshot = cursor.fetchone()[0]
            args = [f'{PG_BIN}/pg_dump', '--format=custom', '--quote-all-identifiers',
                    '--snapshot', snapshot, '--file', str(destination / 'database.dump')]
            result = subprocess.run(args, env=env, capture_output=True, timeout=1800)
            if result.returncode:
                raise RuntimeError('Database export failed')
            # Exact row counts for the same MVCC snapshot used by pg_dump.
            cursor.execute("""SELECT n.nspname,c.relname FROM pg_class c
                              JOIN pg_namespace n ON n.oid=c.relnamespace
                              WHERE c.relkind='r' AND n.nspname NOT LIKE 'pg_%'
                              AND n.nspname <> 'information_schema'
                              ORDER BY 1,2""")
            tables = cursor.fetchall()
            counts = []
            for schema, table in tables:
                cursor.execute(sql.SQL('SELECT count(*) FROM ONLY {}.{}').format(
                    sql.Identifier(schema), sql.Identifier(table)))
                counts.append({'schema': schema, 'table': table, 'rows': cursor.fetchone()[0]})
            (destination / 'row-counts.json').write_text(json.dumps(counts, indent=2) + '\n')
            cursor.execute('SELECT extname,extversion FROM pg_extension ORDER BY extname')
            extensions = cursor.fetchall()
        roles = subprocess.run([f'{PG_BIN}/pg_dumpall', '--roles-only', '--no-role-passwords'],
                               env=env, capture_output=True, timeout=120)
        if roles.returncode:
            raise RuntimeError('Role export failed')
        (destination / 'roles.sql').write_bytes(roles.stdout)
        result = subprocess.run([f'{PG_BIN}/pg_restore', '--list', str(destination / 'database.dump')],
                                capture_output=True, timeout=120)
        if result.returncode:
            raise RuntimeError('Archive catalog verification failed')
        (destination / 'catalog.txt').write_bytes(result.stdout)
        manifest = {'format': 1, 'project': 'kfnsfnytnnpwptklmbip',
                    'tables': len(counts), 'rows': sum(c['rows'] for c in counts),
                    'extensions': extensions, 'role_passwords': 'excluded',
                    'scope': 'pg_dump archive; not a physical platform backup',
                    'files': {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                              for p in destination.iterdir() if p.is_file()}}
        (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        return manifest
    finally:
        connection.rollback()
        connection.close()
