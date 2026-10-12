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

## Invoice review receiving and payment — October 11, 2026

`20261011192921_invoice_review_receiving.sql` adds `approve_invoice_review`, which delegates authorization, stale-version checks, attachment verification and payment to the existing approval functions, then records the invoice-level receiving declaration and audit in the same transaction. It does not create purchase receipts or inventory movements. Review input values are retained in draft extraction metadata for retries.

Validated with synthetic PGlite records by passing this migration as the third argument to `llm-invoice-drafts.mjs` after the original LLM draft migration. Checks received/unreceived, required receiver/date, future-date rejection, payment persistence, role/MFA rejection, replay rejection, and zero receipt/inventory writes. Applied with user authorization on October 11, 2026 before the updated intake endpoint. CLI creation timestamp was 20261011190906; the filename follows the recorded remote version 20261011192921. Verified anonymous execution is denied and authenticated execution is granted. No business records were changed during deployment. To roll back, restore the previous intake/UI version first; keep stored receiving declarations and audit records. Do not replay or reset production.

## Invoice line item type

Migration `20261011195918_invoice_line_item_type.sql` adds nullable invoice-specific `source_item_type` (`purchased` or `prepared`) and persists the reviewed selection through draft creation and editing. Catalog records are unchanged. Pass this migration as the fourth argument to `llm-invoice-drafts.mjs` to validate creation, editing and invalid-type rejection in isolated PGlite. Not applied to production. Deploy the migration before the matching UI; rollback the UI first and preserve the column to retain classifications.

Invoice item type and category migrations were applied and verified on October 11, 2026 (20261011195918 and 20261011195920). Isolated create/edit/category scope validation passed.

## Team and operations follow-up — October 12, 2026

Applied migrations `20261012111302_hr_optional_job_phone_deactivation` and `20261012111312_workday_import_and_invoice_team_receiver` were created using the CLI and validated in isolated PGlite before application. Original CLI timestamps were 20261012105638 and 20261012110336; files follow the recorded remote versions.

Run `supabase/tests/hr.mjs` with the base HR, linked users, profiles, optional job/deactivation, and workday import migrations in order. This covers nullable job/rates, country storage, membership deactivation, owner protection, stale versions, MFA/role denial, preserved workday wages, transactional imports, fingerprint retries, date/person/location duplicates, and scoped receiver/preparer assignment. `team-operations.mjs` uses a small operation fixture to test the new production assignment patch; existing production/stock behavior is not replayed by that fixture. Historical receiver/preparer text is never guessed or backfilled.

The new import fingerprint table deliberately has RLS with no direct grants/policies: only the guarded import RPC writes it. New SECURITY DEFINER RPCs intentionally allow authenticated execution with role, MFA and scope checks; existing profile write triggers still apply to HR, invoices and prep. Anonymous execution is revoked. Advisors retain existing citext/password warnings and intentional RPC findings.

The application saves reports only to private temporary analysis files, owned by the submitting account, then deletes them on import or dismissal. Reports never enter invoice Storage. OpenClaw receives the file with tools disabled and returns candidate rows; users review and confirm them. A synthetic CSV was successfully extracted through the configured gateway; no real workdays were written for verification. Retried identical files return already-imported; another report overlapping existing non-void person/date/location entries is rejected atomically.

Rollback: restore the previous application first. Retain new phone, preparer and receiving metadata, audit history and import fingerprints. Existing APIs remain compatible. Do not delete Auth identities, workdays, invoices or inventory to roll back these UI changes. Restoring workspace access after deactivation is an explicit administrative action, not an automatic consequence of changing the HR status back to active.

Follow-up `20261012112046_order_receipt_team_receiver` (CLI 20261012111921) moves receiver assignment to order receipt. The updated web form/API require a Team member; the receipt trigger verifies active membership in the receipt location and snapshots the person's name while preserving `received_by` as the authenticated recorder. Completed receiver identity is immutable. Historical receipts and old-client compatibility remain; no automatic name matching occurs. The separate invoice reassignment RPC and button were removed. Add this migration as the last argument to the HR isolated test command to validate receiver matching, inactive rejection, recorder preservation and rollback. Invoice draft approval can still capture an explicit team receiver as part of its existing receiving section.
