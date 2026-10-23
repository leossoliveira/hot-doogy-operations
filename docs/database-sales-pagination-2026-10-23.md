# Sales history database bottleneck — October 23, 2026

Status: validated locally; not published or applied to production.

## Diagnosis

Read-only production diagnostics preserved RLS using the authenticated database
role and an existing valid owner/MFA session; no auth records, policies or
business rows were changed. Only timings and plans were returned.

- Supabase logs confirmed statement timeouts during workspace reads.
- The first 1,000 sales IDs used a sequential scan of all 16,050 sales, followed
  by sorting. The planner estimated only 1,003 visible rows; actual rows were
  16,050. One observed EXPLAIN ANALYZE took 1,831 ms with all blocks in cache.
- A transaction-local diagnostic favoring the existing primary-key index took
  25 ms. This was a diagnostic comparison, not a persistent optimizer change
  or a measurement of the final JSON response. Runtime varied considerably.
- The table has 2,469 heap pages, 2,396 all-visible pages, and no existing
  organization/ID covering index. A plain composite index alone still chose
  the full scan in the representative isolated test.
- Performance/security advisors were inspected. Their existing notices are not
  evidence that every missing foreign-key index causes this workload. The change
  targets the observed sales-page plan rather than modifying unrelated policies.

## Change

Migration `20261023120837_indexed_workspace_sales_pages.sql`, created by the
Supabase CLI, adds `(organization_id,id) INCLUDE(location_id)` and a bounded
`workspace_sales_page` security-invoker function. It finds the authorized IDs
using the compact index, then fetches the existing 17 fields for only those IDs.
The lateral LIMIT prevents flattening back into a full-history scan. Dynamic
SQL uses bound UUID/limit values and a custom plan for each cursor.

The index includes only fixed-size UUIDs. Product names and other unbounded
fields remain outside the index so long text cannot make a future write fail
with an oversized index entry. No policies, business-table grants, security
helpers, write handlers, or data are changed. MFA, organization/location and
staff restrictions apply to both phases. Anonymous execution is denied.

Initial workspace batches and continuation pages use the same new reader.
All four disjoint UUID ranges, page limits, full-history completeness, caller
tokens, cancellation, the eight-read ceiling and write invalidation are retained.
There is no response cache, partial workspace, higher concurrency or raised
request timeout. Read failures still abort the response.

## Validation

- `npm test`: 461 tests passed, including server integration reading 16,050
  synthetic records across all UUID ranges with scoped tokens/bounded concurrency.
- `npm run check`: syntax, immutable migration checksums and deployment baseline
  passed (154 migrations; 74 imported checksums unchanged).
- Isolated PostgreSQL/PGlite sales-page test: complete ordered history, no
  duplicates, five roles, tenant/location scope, MFA, expired/revoked session
  simulation, suspended membership, missing identity, invalid limits/ranges,
  anonymous denial, revoked table privilege, allowed/denied writes and 12,000
  character names. Existing policies before/after match exactly.
- All 50 first-page tables passed the updated batch/RLS/injection tests.
- Identical synthetic JSON first-page read: 31.913 ms before, 13.526 ms after.
  The new plan uses an index-only page scan plus bounded primary-key lookups;
  no sequential scan of sales_item_facts. PGlite explicitly enables sequential
  scans and uses production random_page_cost=1.1 for this comparison.
- Browser save-reliability passed: confirmed rejection, connection loss,
  exact retry without duplicate, draft recovery after reload, module navigation,
  confirmation independent of refresh and protection of newer edits.

These measurements demonstrate the identified query improvement, not a promised
production page-load percentage. Other database/network delays may remain.

## Publication and recovery

Publish only this scoped commit from the current remote main, preserving other
unpublished local work. Apply the migration before starting the new application.
The transactional deployment system validates migration history/checksums and
keeps the previous application if preparation fails. Index creation has a
five-second lock-acquisition timeout; it adds a small index to 16,050 rows and
may briefly wait for or delay concurrent writes during deployment. Do not reset,
replay, repair or rewrite historical migrations.

After activation: verify migration checksum, version, authenticated read timings,
absence of failed/partial reads, and real save/reopen. Compare equivalent reads,
not just synthetic timings or slow-request logs (successful requests <=2 seconds
are omitted by the current application logger).

For application rollback, restore the prior release; the additive index/function
and backward-compatible first-page API may remain. If the first-page SQL itself
must be reverted, create a new reviewed migration restoring the previous
workspace_read_batch definition; never edit this migration after application.

References: [Supabase RLS performance](https://supabase.com/docs/guides/database/postgres/row-level-security#rls-performance-recommendations).
