# Query slowdown — 23 October 2026

Production logs from 22:00–22:30 UTC contained 179,690 PostgreSQL 40001 errors. Samples repeatedly came from `private.preparation_sales_page`: “The recipe catalog changed. Restart the calculation.” The application does not retry this code; its calculation reader only retries confirmed 57014 timeouts with a decreasing page limit.

Supabase documents an infinite retry bug in PostgREST 14 when RPC business exceptions use SQLSTATE 40001: https://github.com/orgs/supabase/discussions/50151 . The log samples identify PostgREST 14.5. A permanent stale signature therefore became repeated transactions rather than an HTTP conflict.

The new migration changes deliberate application conflict exceptions in 14 inspected functions to PT409. Genuine PostgreSQL serialization failures are unaffected. Function security, access checks, settings, permissions and business conditions remain unchanged. The application treats PT409 as a definitive rejected save (409), preserving retry/edit behavior and preventing ambiguous-save loops.

Validation: 462 application tests; isolated PostgreSQL test verifies PT409, transaction rollback, unchanged security/ACL/settings; source/bundle/migration checks passed. The migration is applied by the reviewed release updater, without historical replay. Rolling deployment remains compatible because the HTTP conflict is returned by PostgREST itself. Reverting application code does not require reverting the database fix; retain PT409 to avoid restoring the incident.

Production verification pending publication.

## Follow-up: avoid downloading all sales on operational screens

v0.1.141 activated at 22:40:18 UTC. All 14 inspected conflict functions use PT409; none still uses deliberate 40001. The first post-deployment log window (22:40:30–22:41:15 UTC) contained no PostgreSQL ERROR entries. A full workspace still took 9,069 ms, including 4,708 ms workspace read and 620 ms projection. Its Brotli payload was 2.95 MB; uncompressed sales history alone was 10.48 MB. This is a second, independent bottleneck.

The operational scope retains all purchasing, inventory, recipe and receiving details but reads daily sales totals and a content signature instead of every sales fact. Sales, reports and food cost retain the complete-history scope; time-specific Overview filtering also upgrades to that scope. Existing layouts and operational records are unchanged. The signature includes every authorized sales row, so edits and deletions invalidate calculated consumption. No shared-user or stale-data cache is introduced.

Validation: 464 application tests (463 full suite plus the added scoped-read test), browser regression for navigation/error/retry/calendar, isolated PostgreSQL totals/content invalidation/RLS/MFA/tenant/Staff/anon checks. Original raw sale records remain available on demand. Publication applies only the reviewed additive summary RPC migration.
