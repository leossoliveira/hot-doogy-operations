# Source backups

After a verified local commit, run `npm run backup` (Python 3 required). It creates `../../backups/<UTC timestamp>-<commit>/app.zip`, `SHA256.txt` and `manifest.json`. UTC makes timestamps consistent across computers. Existing backups are never overwritten.

The archive contains exactly the committed source, not the current uncommitted working tree. The script compares each archived file against Git, verifies ZIP integrity and records any pending edits in the manifest. Review those edits separately; they are not protected by this source archive. No push or deployment occurs.

To recover: extract into an empty directory, read the manifest, select Node 24, then run `npm run check` and `npm test` in the extracted `app/`. Configure secrets separately only when running the application. Never overwrite production to test recovery.

These local copies do not protect against loss of the computer. Keep an authorized encrypted off-device copy when available. Database backups and Storage backups require separate procedures; a source ZIP does not contain them.

`app-backup-2026-10-07.zip` is an older immutable snapshot. `workspace-git-2026-10-07/` archives metadata from the former workspace template, not application Git.
