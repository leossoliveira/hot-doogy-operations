# Data backup and recovery

Operational as of October 7, 2026. The Supabase project is on the Free plan; its dashboard showed no managed backups. The routines below run on the existing VPS, outside the application release directory. No paid add-on was enabled.

## Coverage and evidence

| Component | Protection | Verified recovery |
| --- | --- | --- |
| Application source and migrations | Local Git commits and source ZIPs | Existing application checks and source backup verification |
| PostgreSQL, including Auth records and Storage metadata | Daily consistent `pg_dump` custom archive, role definitions without passwords, per-table counts and checksums | Restored to isolated PostgreSQL 17.11; all 124 tables and 56,926 rows matched; access-control tests passed |
| Storage objects | Daily export of every bucket, object headers, SHA-256 and original object names | All 417 objects / 68,784,573 bytes restored to local files and hash-verified |
| VPS configuration | Encrypted copy of `/etc/hot-doogy`, `/etc/nginx` and application/update/backup service definitions | File contents and symlink targets checked after restoration |
| Edge Functions | Retrieved source in `supabase/functions/` | Source preserved; not redeployed during this work |
| Platform settings | Dated non-secret inventory in `supabase/recovery/` | Partial inventory; not a complete automatic Management API export |

See [SQL restoration evidence](../supabase/recovery/restore-report-2026-10-07.json). `roles.sql` excludes role passwords. The current Vault contains zero secrets; future encrypted Vault data requires its encryption root key to be preserved separately. New project API/signing keys and SMTP/provider credentials need separate provisioning. Billing, organization access and DNS are outside the SQL archive.

The Auth dashboard currently has Site URL `http://localhost:3000` and no redirect URLs. This was recorded unchanged, not endorsed as a production setting. Review it before relying on password recovery emails. Public Auth settings are captured separately; email templates, complete Auth settings and provider secrets are not fully exported.

## Location, encryption and schedule

- VPS repository: `/var/backups/hot-doogy/restic`, encrypted by restic. It is outside Supabase and outside the application checkout.
- VPS encryption password: `/etc/hot-doogy-backup/restic-password` (root-only). The validated PostgreSQL credential and official CA certificate are in that same private directory. They never enter Git.
- Independent private key copy: workspace `context/recovery/backup-keys/` on the Mac. Preserve this in your password manager or another secure location. Losing all key copies makes the archives unrecoverable.
- Encrypted Mac copy: workspace `backups/service-data/restic/`. This is a verified point-in-time second copy, not an automatically synchronized destination.
- Storage/configuration job: `hot-doogy-backup.timer`, daily at 07:15 UTC plus up to five minutes of jitter.
- Database job: `hot-doogy-database-backup.timer`, daily at 07:30 UTC plus up to five minutes of jitter.
- Both timers catch up after a stopped VPS returns. The intended recovery interval is roughly 24 hours between successful jobs. This is not second-by-second PITR, and failures increase the interval.
- All snapshots are retained; automatic deletion/pruning is deliberately disabled. Review capacity monthly before selecting a retention/pruning policy. Jobs refuse to start with less than 1 GiB free.

Snapshots preserve earlier copies when an object is later replaced or deleted. Files created and deleted entirely between runs are not recoverable. Database and Storage are captured separately, so a restore must reconcile object references across their timestamps; there is no atomic transaction spanning both services.

## Operation

Ubuntu prerequisites: `restic`, `python3-boto3`, `python3-psycopg2`, PostgreSQL client 17 from the official PostgreSQL Apt repository. The installation used restic 0.16.4, boto3 1.34.46 and pg_dump 17.11. OS packages remain managed by Apt.

After provisioning the private credential files, run `bash deploy/install-backups.sh` as root from a reviewed checkout. It executes both jobs successfully before enabling the timers. The deployment uses copies under `/opt/hot-doogy-backup/`; later local commits do not update those copies automatically.

Check status on the VPS:

```sh
python3 /opt/hot-doogy-backup/status.py
systemctl list-timers hot-doogy-backup.timer hot-doogy-database-backup.timer
```

The status command exits nonzero for failure, missing evidence or a backup older than 30 hours. Status files are in `/var/lib/hot-doogy-backup/`. A nonzero systemd job is a failure; `last-success.json` alone is insufficient because a later run may have failed. External email/notification delivery has not been configured.

Every run checks the encrypted repository, restores its new snapshot into a temporary private directory and verifies recovered bytes. Staging and recovered plaintext are removed after the check. Daily database checks validate archive integrity; a SQL-level recovery drill is separate and should be repeated after migration or PostgreSQL changes.

To refresh the Mac replica, run from the application checkout:

```sh
python3 scripts/backup/sync-from-vps.py --identity <existing-authorized-SSH-key>
```

It locks backup execution during the copy, never deletes old local repository files, and verifies every copied encrypted file against the VPS SHA-256. The key path is supplied explicitly and its contents are never copied.

## Recovery procedure

1. Work on an isolated machine or new Supabase project. Keep production intact until recovery has passed.
2. Obtain the encrypted repository and its password from the separate private key location. Set `RESTIC_REPOSITORY`, `RESTIC_PASSWORD_FILE` and a private cache directory. Run `restic snapshots`, then `restic check --read-data`.
3. Select explicit snapshot IDs for `database` and `storage-config`. Restore with `restic restore <snapshot-id> --target <empty-private-directory>`. The original staging directory path is preserved inside the target. Do not restore directly over `/etc` or over the live application.
4. Locate the `database/` directory containing `database.dump`, `roles.sql`, `manifest.json` and `row-counts.json`. For a local drill, create a fresh native Supabase runtime as in [the isolated replay instructions](../supabase/tests/README.md), but disable **all capabilities except the database**. Never use a tunnel to production.
5. Run from the application checkout:

   ```sh
   python3 scripts/backup/verify-database-restore.py \
     --pg-bin <trusted-PostgreSQL-17-bin-directory> \
     --port <isolated-loopback-port> \
     --artifacts <restored-database-directory> \
     --report <private-report-path>
   ```

   The runner uses only `127.0.0.1`, creates a new `backup_drill_*` database, creates missing platform role names without login, restores ownership/ACLs, compares every table's count and runs the application access tests. It never resets or drops a database. Stop and remove this dedicated test runtime afterward: restored Auth data is sensitive.
6. For Storage, the manifest maps original bucket/key names to hashed local filenames. Verify every SHA-256 before upload. Recreate bucket restrictions from the recovered metadata/settings; upload through the destination Storage API or S3 API, preserving headers. Reconcile owners, metadata and application references in the new project. Do not copy object metadata alone and assume the files exist.
7. A hosted destination already has platform-managed schemas, roles and extensions. Do not blindly run a full `pg_restore` over them. Use the current Supabase migration/restore procedure and review destination compatibility. Regenerate platform credentials, deploy the preserved Edge Function, restore Auth settings and verify login, MFA, tenant access, file downloads and email flows before changing production traffic.

The completed drill proves SQL restoration, table counts, access controls and file recovery. It does not prove a complete hosted-project replacement, email delivery or Storage re-upload through a new project's API.

Sources: [Supabase backups](https://supabase.com/docs/guides/platform/backups), [Storage S3 compatibility](https://supabase.com/docs/guides/storage/s3/compatibility), [Supabase restore procedure](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [PostgreSQL Ubuntu packages](https://www.postgresql.org/download/linux/ubuntu/).
