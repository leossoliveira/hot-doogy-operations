# Workspace structure

`app/` is the only active Git repository for the application. Run development commands from this directory.

```text
app/
  src/                 Browser interface
  server/              Server-side services
  public/              Static assets
  supabase/migrations/ Recorded database migrations
  database/            Legacy SQL references; not a deployment sequence
  deploy/              Hosting configuration and runbooks
  docs/                Current technical documentation
  tests/               Portable automated tests
    fixtures/          Synthetic data
    historical/        Export-dependent legacy tests, opt-in only
  scripts/             Development and operational utilities
context/               Private operational context and historical records
backups/               Dated source archives and archived workspace Git metadata
```

The outer Git repository came from a workspace template and is archived separately. Do not initialize another repository at the workspace root. `context/` and `backups/` are outside application Git and must not be copied into it.

Use lowercase English names and hyphens for multiword directories. Keep runtime paths stable. This application has no dependency installation or build step; do not introduce an unnecessary monorepo or separate deployment just to rename directories.

Node.js 24 is selected by `.nvmrc`, package engines and CI. `npm run check` discovers JavaScript automatically; `npm test` is the same portable suite as CI. See [tests](../tests/README.md) and [migrations](../supabase/README.md).

Applied migration history is preserved; isolated replay of all 74 migrations has passed with a recovered baseline and synthetic prerequisites (see `supabase/tests/README.md`). Code backups exclude database contents, secrets and Storage objects. Create a new archive after a verified commit; never overwrite an old backup. See [backup procedures](backups.md).
