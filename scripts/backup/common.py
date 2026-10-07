"""Shared backup configuration and subprocess helpers; no entry point."""
import os
from pathlib import Path
import subprocess
from datetime import datetime, timezone

STATE = Path('/var/lib/hot-doogy-backup')
REPO = '/var/backups/hot-doogy/restic'
PASSWORD = '/etc/hot-doogy-backup/restic-password'


def now():
    return datetime.now(timezone.utc).isoformat()


def restic(*args):
    env = {**os.environ, 'RESTIC_REPOSITORY': REPO, 'RESTIC_PASSWORD_FILE': PASSWORD}
    result = subprocess.run(['restic', *args], env=env, capture_output=True, timeout=1800)
    if result.returncode:
        # Do not echo subprocess output: it can contain private paths or metadata.
        raise RuntimeError(f'restic {args[0]} failed (exit {result.returncode})')
    return result.stdout

