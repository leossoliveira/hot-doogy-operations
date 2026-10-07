# Legacy SQL reference

These scripts predate the versioned history in `../supabase/migrations/`. They remain at their original paths because existing tests and historical documentation reference them.

Do not execute this directory as a deployment sequence. New schema, function and permission changes belong in new Supabase migration files, accompanied by tests and a local commit. Applied migrations are immutable.

See [the migration workflow](../supabase/README.md). A complete clean-database replay still requires the initial schema and an isolated Supabase development environment.
