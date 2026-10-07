#!/usr/bin/env bash
set -euo pipefail
# Run from an authorized, reviewed checkout; does not publish application code.
[[ "$EUID" -eq 0 ]] || { echo 'Run as root on the VPS.' >&2; exit 1; }
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
command -v restic >/dev/null
python3 -c 'import boto3, psycopg2'
/usr/lib/postgresql/17/bin/pg_dump --version
for name in restic-password postgres.pgpass supabase-ca.crt; do
  test -s "/etc/hot-doogy-backup/$name"
done
install -d -m 700 /etc/hot-doogy-backup /var/lib/hot-doogy-backup /var/backups/hot-doogy
chmod 600 /etc/hot-doogy-backup/restic-password /etc/hot-doogy-backup/postgres.pgpass
install -d -m 755 /opt/hot-doogy-backup
install -m 644 "$ROOT"/scripts/backup/*.py /opt/hot-doogy-backup/
install -m 644 "$ROOT"/deploy/hot-doogy-backup.{service,timer} /etc/systemd/system/
install -m 644 "$ROOT"/deploy/hot-doogy-database-backup.{service,timer} /etc/systemd/system/
export RESTIC_REPOSITORY=/var/backups/hot-doogy/restic
export RESTIC_PASSWORD_FILE=/etc/hot-doogy-backup/restic-password
export RESTIC_CACHE_DIR=/var/lib/hot-doogy-backup/cache
if [[ ! -f "$RESTIC_REPOSITORY/config" ]]; then restic init; fi
systemd-analyze verify /etc/systemd/system/hot-doogy-backup.{service,timer} /etc/systemd/system/hot-doogy-database-backup.{service,timer}
systemctl daemon-reload
# Verify both jobs before enabling unattended execution.
systemctl start hot-doogy-backup.service
systemctl start hot-doogy-database-backup.service
systemctl enable --now hot-doogy-backup.timer hot-doogy-database-backup.timer
