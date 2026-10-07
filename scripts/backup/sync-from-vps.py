#!/usr/bin/env python3
"""Copy encrypted repository to this workspace and compare every file hash."""
import argparse
import hashlib
import json
from pathlib import Path
import shlex
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--identity', type=Path, required=True, help='Existing authorized SSH key')
args = parser.parse_args()
root = Path(__file__).resolve().parents[3]
destination = root / 'backups/service-data/restic'
destination.mkdir(parents=True, mode=0o700, exist_ok=True)
destination.parent.chmod(0o700)
ssh = ['ssh', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-i', str(args.identity.resolve())]
# Lock the backup runner while rsync reads the repository. Closing SSH input
# releases the lock. No remote file is deleted.
lock = subprocess.Popen(ssh + ['root@2.24.118.177',
    "flock -w 300 /var/lib/hot-doogy-backup/run.lock sh -c 'echo locked; read -r release'"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
try:
    if lock.stdout.readline().strip() != 'locked':
        raise RuntimeError('Unable to lock backup repository for copy')
    subprocess.run(['rsync', '-a', '--checksum', '--exclude', 'locks/', '-e', shlex.join(ssh),
                    'root@2.24.118.177:/var/backups/hot-doogy/restic/', str(destination) + '/'],
                   check=True, timeout=1800)
    remote = """import hashlib,json
from pathlib import Path
root=Path('/var/backups/hot-doogy/restic')
print(json.dumps({str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest()
 for p in root.rglob('*') if p.is_file() and 'locks' not in p.relative_to(root).parts}))
"""
    result = subprocess.check_output(ssh + ['root@2.24.118.177', 'python3 -'],
                                     input=remote.encode(), timeout=300)
    expected = json.loads(result)
    for name, digest in expected.items():
        file = (destination / name).resolve()
        if destination.resolve() not in file.parents:
            raise ValueError('Unsafe repository path')
        if hashlib.sha256(file.read_bytes()).hexdigest() != digest:
            raise ValueError('Encrypted copy checksum mismatch')
    print(f'Encrypted replica verified: {len(expected)} files.')
finally:
    if lock.stdin:
        try:
            lock.stdin.write('release\n')
            lock.stdin.flush()
        except BrokenPipeError:
            pass
        lock.stdin.close()
    lock.wait(timeout=15)
