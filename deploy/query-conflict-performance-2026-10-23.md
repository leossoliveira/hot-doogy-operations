# Query slowdown — 23 October 2026

Production logs from 22:00–22:30 UTC contained 179,690 PostgreSQL 40001 errors. Samples repeatedly came from `private.preparation_sales_page`: “The recipe catalog changed. Restart the calculation.” The application does not retry this code; its calculation reader only retries confirmed 57014 timeouts with a decreasing page limit.

Supabase documents an infinite retry bug in PostgREST 14 when RPC business exceptions use SQLSTATE 40001: https://github.com/orgs/supabase/discussions/50151 . The log samples identify PostgREST 14.5. A permanent stale signature therefore became repeated transactions rather than an HTTP conflict.

The new migration changes deliberate application conflict exceptions in 14 inspected functions to PT409. Genuine PostgreSQL serialization failures are unaffected. Function security, access checks, settings, permissions and business conditions remain unchanged. The application treats PT409 as a definitive rejected save (409), preserving retry/edit behavior and preventing ambiguous-save loops.

Validation: 462 application tests; isolated PostgreSQL test verifies PT409, transaction rollback, unchanged security/ACL/settings; source/bundle/migration checks passed. The migration is applied by the reviewed release updater, without historical replay. Rolling deployment remains compatible because the HTTP conflict is returned by PostgREST itself. Reverting application code does not require reverting the database fix; retain PT409 to avoid restoring the incident.

Production verification pending publication.
