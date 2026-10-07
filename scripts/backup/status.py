#!/usr/bin/env python3
"""Exit nonzero if either backup failed or is older than 30 hours."""
from datetime import datetime, timezone
import json
from pathlib import Path

failed = False
for name in ['last-run.json', 'database-last-run.json']:
    try:
        record = json.loads((Path('/var/lib/hot-doogy-backup') / name).read_text())
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(record['completed_at'])).total_seconds()
        good = record['status'] == 'passed' and 0 <= age <= 30 * 3600
    except (OSError, ValueError, KeyError):
        good = False
    print(f'{name}: {"healthy" if good else "FAILED OR STALE"}')
    failed = failed or not good
raise SystemExit(1 if failed else 0)
