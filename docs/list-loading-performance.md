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

## Production measurement and bounded batches

Release v0.1.103 (`81fb6f0efc9cada4103c64adf02c166854c9dd1a`) and schema `20261021012310` activated at 2026-10-21 01:36:17 UTC. Its first authenticated reload measured 11,995 ms, down from 25,552 ms. This was still too slow. Production logs showed repeated Data API communication remained material even after the query improvement.

Migration `20261021013805_bounded_workspace_read_batches` adds an explicitly allowlisted, security-invoker read function. Each call returns first pages for at most eight tables, at most 500 rows per table (1,000 for compact sales facts). It uses the same organization filters, columns, ordering and user RLS as the existing reader. Subsequent cursor pages retrieve every remaining row. The normal workspace reader uses seven first-page requests instead of fifty; staff requests retain their narrower table list. Per-workspace and process-wide request limits are unchanged. No completed-response cache or stale success state is added.

The isolated batch test verifies all 50 tables, bounded/ordered pages, tenant/location/MFA enforcement, rejection of arbitrary table names, anonymous denial, and that revoking SELECT cannot be bypassed by the function. JavaScript tests verify pagination after seeded first pages, staff table filtering, token forwarding, concurrency and failure on incomplete batches. Batched reads can use all eight existing process-wide slots when they are idle; they do not increase the total database concurrency permitted across users. Legacy individual readers retain their four-request limit.

Live navigation found another client-side delay: Food Cost took 2,226 ms to render while the other checked operational/purchasing lists took 16–271 ms after the shared data loaded. Supplier cost resolution cloned every supplier and price history for each ingredient, then discarded unrelated entries. It now selects the immutable item identity before applying local edits. Prices and active edits remain freshly calculated; no cost cache is introduced. A regression test includes 1,000 unrelated suppliers and verifies unchanged totals and immediate price/active changes without materializing unrelated histories.
