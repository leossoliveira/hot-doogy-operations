# Workspace structure

`app/` is the only active Git repository for the application. Run development commands from this directory.

```text
app/
  src/                 Browser interface
  server/              Server-side services
  public/              Static assets
  supabase/
    migrations/        Recorded, immutable database migrations
    functions/         Versioned Edge Function source
    recovery/          Non-secret recovery inventory and verification reports
    bootstrap/         Isolated replay prerequisites
    tests/             Database validation
  database/            Legacy SQL references; not a deployment sequence
  deploy/              Hosting configuration and runbooks
  docs/                Current technical documentation
  tests/               Portable automated tests
    fixtures/          Synthetic data
    historical/        Export-dependent legacy tests, opt-in only
  scripts/             Development and operational utilities
    backup/            Database, Storage and encrypted replica tools
    historical/        One-off utilities requiring archived exports
context/               Private operational context and historical records
backups/               Private source archives, archived Git and encrypted service data
  service-data/        Encrypted database/Storage/configuration replica
```

The outer Git repository came from a workspace template and is archived separately. Do not initialize another repository at the workspace root. `context/` and `backups/` are outside application Git and must not be copied into it.

Use lowercase English names and hyphens for multiword directories. Keep runtime paths stable. This application has no dependency installation or build step; do not introduce an unnecessary monorepo or separate deployment just to rename directories.

Node.js 24 is selected by `.nvmrc`, package engines and CI. `npm run check` discovers JavaScript, Python and shell files automatically; `npm test` is the same portable suite as CI. See [tests](../tests/README.md) and [migrations](../supabase/README.md).

Applied migration history is preserved; isolated replay of all 74 migrations has passed with a recovered baseline and synthetic prerequisites (see `supabase/tests/README.md`). Code backups exclude database contents, secrets and Storage objects. Create a new archive after a verified commit; never overwrite an old backup. See [backup procedures](backups.md).

## Tooling requirements

| Purpose | Requirements |
| --- | --- |
| Application and portable JavaScript tests | Node.js 24; no dependency installation or build step |
| Syntax checks and offline backup tests | Python 3.9+ standard library and Bash; no production credentials |
| VPS backup jobs | Linux, Python 3.9+, boto3, psycopg2, restic, PostgreSQL 17 client tools and private configuration |
| Encrypted replica download | Python 3.9+, SSH, rsync and an authorized SSH key |
| SQL restoration drill | Isolated PostgreSQL 17 and recovery tools described in data-recovery.md |

Run `npm run check`, `npm run test:ci` and `npm run test:backup` before committing changes to backup tools. Python validation parses syntax without importing modules or producing cache files; shell validation does not execute scripts. Exported Edge Function TypeScript is outside this syntax check.

`common.py` contains shared backup settings and restic execution. Runners import it without importing one another. The installer copies all backup modules together. Local commits do not deploy changes to the VPS; follow the authorized deployment workflow before updating installed jobs.

See [historical utilities](../scripts/historical/README.md) and [data recovery](data-recovery.md).
