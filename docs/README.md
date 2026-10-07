# Technical documentation

This directory is the current source for application documentation. Keep instructions here aligned with the code in the same commit. Private context and historical records live outside this repository in the workspace `context/` directory; they are reference material, not current installation instructions.

- [Application overview and local setup](../README.md)
- [Workspace structure](workspace-structure.md)
- [Hosting configuration and maintenance](../deploy/README.md)
- [Source backups and recovery](backups.md)
- [Automated tests](../tests/README.md)
- [Database migration history](../supabase/README.md)
- [Isolated database replay and validation limits](../supabase/tests/README.md)
- [Administrative MFA](administrative-mfa.md)
- [Responsive layout](responsive-layout.md)
- [Calendar controls](calendar-controls.md)

## Change workflow

Verify each completed change, create a local commit, then create a source backup with `npm run backup` from the application root. A source archive includes committed files only. GitHub publication requires the separate authorization described in [AGENTS.md](../AGENTS.md). Hosting configuration files are templates: committing them does not install them on the VPS. Validate Nginx on the destination server before any authorized reload.
