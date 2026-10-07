#!/usr/bin/env python3
"""Encrypted, verified Storage/config snapshots. No writes to Supabase."""
import fcntl
import json
import os
from pathlib import Path
import shutil
import tempfile
from storage import client, export, verify

from common import STATE, now, restic


def run():
    os.umask(0o077)
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (STATE / 'run.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        status = {'started_at': now(), 'coverage': ['storage-objects', 'vps-configuration'],
                  'database': 'not-included-requires-separate-backup'}
        try:
            if shutil.disk_usage(STATE).free < 1024 ** 3:
                raise RuntimeError('Less than 1 GiB free; backup stopped')
            with tempfile.TemporaryDirectory(prefix='stage-', dir=STATE) as temp:
                stage = Path(temp)
                count, size = export(client('/etc/hot-doogy/supabase-s3.env'), stage / 'storage')
                config = stage / 'configuration'
                config.mkdir()
                sources = ['/etc/hot-doogy', '/etc/nginx',
                           '/etc/systemd/system/hot-doogy.service',
                           '/etc/systemd/system/hot-doogy-update.service',
                           '/etc/systemd/system/hot-doogy-update.timer',
                           '/etc/systemd/system/hot-doogy-backup.service',
                           '/etc/systemd/system/hot-doogy-backup.timer',
                           '/etc/systemd/system/hot-doogy-database-backup.service',
                           '/etc/systemd/system/hot-doogy-database-backup.timer']
                for source in sources:
                    path = Path(source)
                    if not path.exists():
                        raise RuntimeError('Expected configuration missing')
                    target = config / path.relative_to('/')
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if path.is_dir():
                        shutil.copytree(path, target, symlinks=True)
                    else:
                        shutil.copy2(path, target)
                (stage / 'coverage.json').write_text(json.dumps(status, indent=2) + '\n')
                output = restic('backup', '--json', '--tag', 'storage-config', str(stage))
                summary = next(x for x in (json.loads(line) for line in output.splitlines())
                               if x.get('message_type') == 'summary')
                snapshot = summary['snapshot_id']
                restic('check', '--read-data')
                with tempfile.TemporaryDirectory(prefix='restore-', dir=STATE) as restored:
                    restic('restore', snapshot, '--target', restored)
                    tree = Path(restored) / stage.relative_to('/')
                    checked = verify(tree / 'storage')
                    # Verify every configuration byte, including symlink targets.
                    for original in config.rglob('*'):
                        recovered = tree / 'configuration' / original.relative_to(config)
                        if original.is_symlink():
                            if not recovered.is_symlink() or os.readlink(original) != os.readlink(recovered):
                                raise ValueError('Configuration symlink mismatch')
                        elif original.is_file():
                            if original.read_bytes() != recovered.read_bytes():
                                raise ValueError('Configuration restore mismatch')
                status.update(status='passed', snapshot=snapshot, objects=checked,
                              bytes=size, completed_at=now(),
                              restore_scope='all-files-restored-locally-and-hash-verified')
            (STATE / 'last-success.json').write_text(json.dumps(status, indent=2) + '\n')
            print(json.dumps(status))
        except Exception as error:
            status.update(status='failed', error_type=type(error).__name__, completed_at=now())
            print(json.dumps(status))
            raise SystemExit(1) from None
        finally:
            (STATE / 'last-run.json').write_text(json.dumps(status, indent=2) + '\n')


if __name__ == '__main__':
    run()
