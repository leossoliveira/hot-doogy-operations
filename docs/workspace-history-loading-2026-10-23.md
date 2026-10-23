# Workspace history loading — October 23, 2026

Status: validated locally; not published. No database migration.

## Evidence

Read-only production diagnostics retained the authenticated role, an existing
valid MFA session's database claims, and all RLS policies. Only timings, counts
and query statistics were returned. No business records or credentials were
exported. An attempted server session-store diagnostic was rejected before
execution; diagnosis continued through the database connector instead.

Production table statistics showed 16,050 sales facts, 3,735 purchase-order lines,
3,715 invoice lines, and 2,445 inventory transactions. The latter three histories
used a 500-row first page followed by serial 500-row cursor pages: 8, 8 and 5
pages respectively. Each page repeats query planning/authorization and a network
round trip. The sales first page also shared an RPC with unrelated tables,
delaying its continuation until the whole batch completed.

A sequential authenticated SQL probe of all 3,715 invoice lines returned the
same row count in both cases: eight pages at 500 versus five pages with a
500-row first page and 1,000-row continuations. Timings were 271.9 and 89.8 ms.
This is one warm-up/order-sensitive database sample, not an end-to-end speed claim.
The Data API already supports 1,000-row sales pages; continuation sizes remain
within that bound. No permissions, indexes, functions or timeout limits change.

## Change

- Start sales as a separate first-page batch and group the three larger histories
  together, ahead of the remaining tables. Every first-page batch still has at
  most eight tables; the existing timeout-splitting recovery remains intact.
- Use 1,000-row continuations for purchase-order lines, invoice lines and
  inventory transactions. Explicitly distinguish the supplied first page's
  500-row size from the continuation size, so the first page is never mistaken
  for the end of a history.
- Preserve the global eight-read ceiling, caller tokens, staff exclusions,
  keyset ordering, abort behavior, in-flight deduplication and write invalidation.
  Small tables and all non-batch consumers keep their current behavior.
- Do not change photo uploads, save handlers, retries, authentication or caching.

## Verification

`npm run check` passed (290 JavaScript files; 154 migration filenames; 74 imported
checksums unchanged). `npm test` passed all 464 tests. New tests cover empty,
short and exact page boundaries, skewed IDs, failed/nonadvancing continuations,
complete histories for three simultaneous users, token scope and a peak of eight
reads. Existing staff, late-failure, timeout-splitting and invalidation tests pass.

The browser save-reliability suite passed: confirmed rejection, lost response,
exact replay, reload recovery without duplicates, module navigation, confirmation
before refresh, protection of newer edits, and reopening the saved item.

Reproduce the synthetic mixed-history benchmark with:

```sh
node scripts/benchmark-workspace-histories.mjs 9d5995f
```

It checks equality of all 50 tables (31,415 synthetic rows), with the same latency
model and global concurrency limit. Before: 812/815/818 ms, 51 requests. After:
683/686/680 ms, 44 requests. Median reduction: about 16%; peak concurrency: eight
in both versions. More parallel range workers alone were evaluated and omitted
because the mixed workload showed little benefit and more requests.

## Publication and limits

Publish only this scoped change on top of the current remote main; do not include
unrelated unpublished local work. No migration is required. After publication,
measure complete authenticated loads under comparable conditions and repeat a
real save and reload. The current production version remains v0.1.124.

This reduces repeated database/network work; it does not establish that every
remaining delay is resolved. Production's variable query latency and the photo
manifest/storage latency remain separate contributors. A consistent production
improvement must be verified after deployment. Rollback is application-only to
the prior validated release, with no database reversal.

Reference: [Supabase RLS performance](https://supabase.com/docs/guides/database/postgres/row-level-security-performance).
