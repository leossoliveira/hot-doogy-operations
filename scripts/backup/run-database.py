#!/usr/bin/env python3
import fcntl
import hashlib
import json
import os
import shutil
from pathlib import Path
import tempfile
from database import export
from common import STATE, now, restic


def run():
    os.umask(0o077)
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (STATE / 'run.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        status = {'started_at': now(), 'coverage': ['database', 'auth-records', 'storage-metadata']}
        try:
            if shutil.disk_usage(STATE).free < 1024 ** 3:
                raise RuntimeError('Less than 1 GiB free; backup stopped')
            with tempfile.TemporaryDirectory(prefix='database-', dir=STATE) as temp:
                stage = Path(temp)
                manifest = export(stage / 'database')
                output = restic('backup', '--json', '--tag', 'database', str(stage))
                summary = next(x for x in (json.loads(line) for line in output.splitlines())
                               if x.get('message_type') == 'summary')
                snapshot = summary['snapshot_id']
                restic('check', '--read-data')
                with tempfile.TemporaryDirectory(prefix='database-restore-', dir=STATE) as restored:
                    restic('restore', snapshot, '--target', restored)
                    tree = Path(restored) / stage.relative_to('/') / 'database'
                    for name, digest in manifest['files'].items():
                        if hashlib.sha256((tree / name).read_bytes()).hexdigest() != digest:
                            raise ValueError('Database archive restore mismatch')
                status.update(status='passed', snapshot=snapshot, tables=manifest['tables'],
                              rows=manifest['rows'], completed_at=now(),
                              restore_scope='encrypted-archive-restored-and-hash-verified; SQL drill separate')
            (STATE / 'database-last-success.json').write_text(json.dumps(status, indent=2) + '\n')
            print(json.dumps(status))
        except Exception as error:
            status.update(status='failed', error_type=type(error).__name__, completed_at=now())
            print(json.dumps(status))
            raise SystemExit(1) from None
        finally:
            (STATE / 'database-last-run.json').write_text(json.dumps(status, indent=2) + '\n')


if __name__ == '__main__':
    run()
