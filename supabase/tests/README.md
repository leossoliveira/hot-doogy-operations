# Isolated database replay

Validated on October 7, 2026 with Supabase CLI 2.120.0, the experimental native runtime on Apple silicon, and PostgreSQL 17.11. The environment was created separately from the application and never linked to production.

## Reproduce

1. Install a pinned CLI in a temporary tools directory: `npm install --prefix /tmp/db-replay-tools --save-exact supabase@2.120.0`.
2. Create a fresh temporary project directory with a `supabase/` subdirectory. Copy `runtime.toml` from this directory to its `supabase/config.toml`. Do not copy application migrations into that temporary project: the replay runner controls ordering and prerequisites.
3. Set `SUPABASE_HOME` to a new temporary directory. Run the installed CLI with `start --workdir <temporary-project> --runtime native --preparation on-demand --exclude studio,mail,analytics,functions,realtime,pooler`. Read `--help` first if upgrading. The runtime downloads and verifies its service binaries. Keep its connection output private.
4. Obtain the database loopback port from `supabase status --workdir <temporary-project>` using the same `SUPABASE_HOME`. Use the trusted `psql` binary provided by the native runtime under its cache, or a compatible local PostgreSQL client.
5. From the application directory, run:

   ```sh
   python3 scripts/replay-database.py --psql <trusted-psql-path> --port <local-port> --report /tmp/replay-report.json
   ```

6. Stop this test stack with `supabase stop --workdir <temporary-project>` using the same CLI and `SUPABASE_HOME`. Never use `--all` to stop unrelated stacks.

The runner is restricted to `127.0.0.1`, the local `postgres` credentials and a database without application tables or views. It refuses a second run against populated application schemas and never resets a database. For another clean run, provision a fresh temporary stack. Do not run these steps against a tunnel to production.

## Inputs and checks

- `../bootstrap/initial-schema.sql`: recovered prerequisites for the manual sections 001–005, inferred from real production metadata. It is not the exact original manual script or a migration to deploy.
- `replay-seed.sql`: two synthetic records needed by the historical Fountain Soda migration. The organization ID/name and menu label come from the existing migrations; no business rows were exported.
- All 74 imported migrations are executed unchanged, each in its own transaction.
- `catalog.sql` and `expected-catalog.json`: the production catalog captured read-only on October 7. Checks 85 table names/RLS flags, 816 column names/types/nullability, 210 public policy definitions, and 113 function identities/security-definer flags.
- `access-control.sql`: rolled-back synthetic users test manager access to one store, tenant isolation, the application's table-read permissions, admin MFA enforcement, and anonymous access denial.
- `replay-report-2026-10-07.json`: successful clean replay evidence.

The schema fingerprint does not compare every function body, index, trigger, default or grant. This is not a full security audit, a data restore, or an end-to-end Auth/Storage API test. No production writes, schema changes, uploaded files or user records were performed. Historical data-only migrations may affect zero rows in this clean fixture; passing replay does not prove their effect on production data.

Update the expected catalog deliberately when introducing a reviewed schema change; it is a dated reference, not a live sync. Keep applied migrations immutable.

Native runtime documentation: https://supabase.com/docs/guides/local-development/docker-and-native-runtimes

## Count quantity/UOM correction

`edit-count.mjs` validates the correction function in an isolated PGlite database with synthetic records. Pass the migration file as the first argument and, if needed, set `PGLITE_MODULE_PATH` to the installed PGlite module. It covers modern observations, legacy entries and base-only lines; zero values; unit conversion; stale-write rejection; invalid units/quantities; MFA, Staff and store restrictions; and audit records. It never connects to a remote database.

Migration `20261009014307_edit_inventory_count_quantity_unit.sql` was applied with user authorization after isolation validation. The CLI initially generated timestamp 20261009014005; the filename follows the applied remote version. No business quantities were changed during verification. The UI retains existing Staff read-only access to saved counts.

## Invoice document classification — October 11, 2026

`invoice-document-review.mjs` tests migration `20261011142253_invoice_document_classification_gate.sql` in isolated PGlite with synthetic records. Set `PGLITE_MODULE_PATH` to an installed PGlite module and pass the migration path. Covers missing/receipt classification on new invoices, explicit human review, MFA/access rejection, file hash binding, review expiry, single-use confirmation, attachment guards and permissions. The existing S3 integrity function is a fixture stub; this test does not upload files or replace its existing integrity tests.

Created via CLI as 20261011141839; filename follows the applied remote version 20261011142253. Existing invoices remain unchanged and are not retrospectively content-verified. New records require `documentKind: 'invoice'` and `documentReviewed: true` in the web operation; direct administrative inserts require `document_kind: 'invoice'`. File upload additionally requires a recorded, authenticated human classification bound to the actual SHA-256 and size. This is an audited human-review gate, not OCR or automatic content recognition. A false declaration by an authorized reviewer cannot be detected by this mechanism. Service credentials remain trusted and must never be used to upload receiving proofs directly.

Rollback, if explicitly authorized: revert the application changes; restore the original invoice insertion in `private.web_operation`; remove the two `invoice_review_backend_*` policies and `invoice_document_review_guard`; drop the public confirmation wrapper and move the preserved private confirmation function back to public, restoring only its service-role grant. Archive review audit evidence before removing the new review function/table or classification column. Do not replay/reset production or alter historical migrations.
