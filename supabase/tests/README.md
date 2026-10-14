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

## Order deletion
`PGLITE_MODULE_PATH=... node supabase/tests/order-deletion.mjs supabase/migrations/20261012113615_confirmed_order_deletion.sql` validates role/MFA, tenant scope, stale versions, explicit confirmation, audit and preservation of linked invoices, receipt quantities, receiver and inventory movements in an isolated reduced schema. Live relationship and receiver triggers were inspected; this is not a full production replay. No live order was deleted. The migration only creates the callable operation. Rollback: remove the two `delete_order(uuid,uuid,timestamptz,boolean)` functions and the UI/API action; actual confirmed deletions cannot be undone through the app.

## Personal calendar connections
`my-day-calendar.mjs` accepts the calendar connection and wrapper migrations as arguments. PGlite validates personal-task isolation, location scopes, disabled profiles/accounts, MFA, rotation and anon wrapper execution without private-schema access. `tests/my-day-calendar.test.mjs` covers iCloud URL allowlisting, redirect rejection, ICS escaping, all-day dates, recurrence exceptions and timezone conversion. Private connection rows hold the published incoming URL and a SHA-256 of the export token; neither table nor URL is available to anonymous callers. The intentionally anonymous subscription only returns title, date and status of the connected user's assigned tasks. Revocation empties the subscription; it does not remove copies already fetched by calendar clients. No tasks or appointments are created by connecting calendars.

## Editable order details
`PGLITE_MODULE_PATH=... node supabase/tests/order-edit.mjs supabase/migrations/20261012161149_editable_order_details.sql` tests the new draft edit RPC in an isolated reduced schema: role, MFA, tenant/location/supplier scope, stale versions, invalid quantities/prices and line identities, totals and audit. Edits preserve line IDs, invoices and inventory. No production migration or operational data was changed. Deploy the migration before the application. Rollback the UI/API first, then drop the public and private `edit_order_details(uuid,uuid,timestamptz,text,jsonb)` functions; preserve audit records and saved edits.

Order product additions/removals: pass `supabase/migrations/20261012161502_order_edit_add_remove_products.sql` as the second migration to `order-edit.mjs`. The isolated fixture verifies adding supplier products, rejecting inactive/wrong-location/missing products, deleting omitted lines, empty drafts, recalculated totals and preserved invoices. New lines derive item/unit IDs from the authorized supplier catalog. Existing line IDs remain unchanged. Both migrations must be deployed before enabling saves; neither has been applied by this change. Rollback by restoring the preceding function via a new migration and reverting the add/remove UI; retain saved lines and audit history.

Published October 12, 2026 with user authorization: both order-edit migrations were applied before the application release. Filenames now match remote versions 20261012161149 and 20261012161502 (original CLI timestamps 20261012152838 and 20261012155906). No order records were changed during deployment.

## Recipe management fields — October 14, 2026

Migration `20261014122848_recipe_management_fields.sql` adds nullable `recipes.use_by_days` (whole days, 1–365) and extends the recipe save in `private.web_operation` with optional `name`, `useByDays`, `units` and `yieldQuantity`/`yieldUnitId` keys. An absent key leaves the value unchanged. A name change also renames the prep item. Yield applies to the new version only. Conversions update or add units of the prep item and never change the base unit factor. The patch refuses to run twice or when the expected recipe save text is missing.

`recipe-management.mjs` validates it in isolated PGlite with synthetic records, after the original function and `20261012190801`. Pass the migration path and set `PGLITE_MODULE_PATH`. Created without the CLI, which was not installed. Applied to production with user authorization on October 14, 2026, after confirming the remote history matched and the recipe save text appeared exactly once. The file was created as 20261014121928; the filename follows the recorded remote version 20261014122848. Verified the column, check constraint, patched function, security definer and unchanged execute grants. No recipe values were changed. Before this migration the app shows the Management tab read-only. Rollback, if authorized: restore the previous function definition and keep the column so stored values are not lost.

Fix `20261014123927_recipe_rename_prep_item_internal_name.sql`: the management migration renamed the prep item through `inventory_items.name`, which was dropped on October 6 in favour of `internal_name`. Renaming a prep recipe therefore failed and rolled back the whole save; no data was changed. The fix rewrites that one statement to `internal_name`. The fixture now mirrors the real column, and `recipe-management.mjs` takes follow-up fixes as extra arguments: without the fix it reproduces the error, with it the test passes. Verified on October 14, 2026 that production already runs the fixed statement and no longer contains the old one; the change reached production outside the migration tool, so `supabase_migrations.schema_migrations` has no row for it. The filename keeps its local version 20261014123927. A later attempt through the migration tool stopped safely at its guard. Do not insert the history row by hand without a separate decision.

## Waste reporter name — October 14, 2026

`20261014141659_waste_reporter_standard_name.sql` makes `private.record_waste` store `reported_by_name` with `private.internal_request_requester_name`, the same name the waste form shows, prep batches record and internal requests use. Previously it used the raw sign-up metadata name. `waste-reporter-name.mjs` validates it in isolated PGlite on top of the original waste migration (pass the migration path). The patch refuses to run twice or if the expected expression is missing. Production had no waste records when this was written, so no stored name differs. Applied to production with user authorization on October 14, 2026 (created locally as 20261014131015 without the CLI; the filename follows the recorded remote version).

## Waste automatic notes — October 14, 2026

OpenClaw records WhatsApp waste directly in the tables with service credentials, so its rows have `reported_by` null and skip `record_waste`. It added its own annotations to `notes` ("WhatsApp Food Waste Log (Sherwood Plaza)", "Registrado via grupo Food Waste Log (...)"). `20261014141703_waste_strip_automatic_notes.sql` adds a trigger that, for rows without an app user, splits notes on " - " and drops parts mentioning WhatsApp, Food Waste Log, "Registrado via" or OpenClaw; the human part ("Azedo") stays. It also cleans existing automation rows the same way. App users' notes are never changed. `waste-notes.mjs` validates it in isolated PGlite. Applied to production with user authorization on October 14, 2026; five of six existing automation notes became empty and one kept "Azedo". The first version of the trigger ran with the inserting role's rights, and service_role has no usage on schema private, so OpenClaw inserts would have failed. Fix `20261014141742_waste_notes_trigger_security_definer.sql` makes the trigger security definer; applied about one minute later, and no waste was inserted in between. `waste-notes.mjs` takes follow-up fixes as extra arguments and now inserts as a role without access to private, reproducing the failure without the fix. The wording check is a pattern: if OpenClaw changes its annotation text, update the pattern or change the OpenClaw instructions on the VPS.

## Waste reporter linked to Team Member — October 14, 2026

`20261014142056_waste_reported_team_member.sql` adds `waste_events.reported_team_member_id` (references `hr_team_members`, set null on delete) and a security definer trigger. App users link through their login. Automation rows (OpenClaw, no app user) link by name: an exact full name of one active team member at that location, otherwise a unique first name there. Ambiguous, inactive or other-store names stay unlinked. A linked record stores the team member's full name. An explicit assignment wins; a rename relinks or drops a stale link. Existing records are linked by the migration ("Martiese" matched one active team member at Sherwood Plaza). `waste-team-member.mjs` validates it in isolated PGlite, inserting as a role without access to private. Not applied to production yet.
