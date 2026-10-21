# List loading and refresh performance

Authorized scope: improve loading and refreshing throughout the application, publish, and verify production. Existing immediate save confirmation remains separate from list refresh.

## Changes

- Migration `20261021012310_workspace_list_read_performance` replaces repeated row-by-row read checks with authorized sets and uncorrelated parent reads in 39 existing SELECT policies. Existing role, tenant, location, supplier, storage, MFA and write restrictions remain in place. No operational records or grants change.
- Inventory history uses 500-row cursor pages after the policy optimization. Sales history uses 1,000-row pages over disjoint UUID ranges, retaining all rows and the existing per-workspace limit of four requests and process-wide limit of eight. No offsets, history cutoffs or shared data cache.
- Simultaneous authenticated requests share only their in-progress session validation; the next request rechecks current access. No authorization TTL is introduced.
- Each photo requests access to its own item/recipe instead of loading both entire catalogs. Photo listings are fully paginated. Unchanged photo metadata no longer redraws the current list a second time.
- Public application assets use gzip and conditional revalidation. Changed content gets a new ETag immediately; API and private image responses retain no-store.

## Verification before release

- Production baseline: authenticated Overview reload took 25,552 ms on October 21, 2026 UTC, measured from reload to visible Overview heading through the browser.
- 434 JavaScript tests passed, including complete bounded history reads, fresh revocation checks, scoped photo requests, compression and changed-asset revalidation.
- Isolated PostgreSQL-compatible test compares exact pre-change and post-change visible IDs across 39 tables and 15 authorization scenarios. Write/restrictive policies remain unchanged. Synthetic 2,400-movement dataset, 500-row authenticated query: 78.7 ms before, 1.8 ms after in PGlite; these are isolated query timings, not production page timings.
- Browser suites passed: module navigation, supplier save recovery, immediate confirmation for orders/invoices/counts/HR/tasks, and count draft/recovery behavior.

The policy fixture contains schema expressions only. Test records are synthetic. Production validation uses authenticated read-only navigation and reloads, not financial or inventory mutations.

## Deployment and rollback

Publish only this change on the current production branch, excluding unrelated local handover work. The release deployer applies the included migration transactionally before switching the application. If activation fails, the prior application remains compatible with the read-policy optimization. Do not reset/replay production or remove migration history. A future policy rollback must be a separately versioned migration using the preserved baseline expressions.

Production release identity and observed timings are recorded after deployment, not inferred from local tests.
