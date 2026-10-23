# Workspace continuation pipeline

Prepared locally; not deployed. No database migration required.

The full workspace read previously waited for all seven initial RPC batches
before reading any continuation pages. Now each validated batch starts its own
continuation immediately, overlapping pagination with slower unrelated batches.
The response still waits for every table; failures abort the whole read. Caller
tokens, organization scope, staff restrictions, cursor boundaries, the global
ceiling of eight reads, timeout splitting and write invalidation are unchanged.
No response cache or partial workspace is introduced.

## Evidence

- `npm test`: 459 passing tests, including full history, concurrent-user read
  bounds, save recovery, invalidation and two new continuation/failure tests.
- `npm run check`: syntax and migration manifest checks passed.
- Browser `tests/browser/save-reliability.mjs`: edit/create rejection, lost
  response replay, reload recovery without duplicate, module navigation and
  delayed refresh preserving newer edits all passed against synthetic APIs.
- `node scripts/benchmark-workspace-pipeline.mjs 8fc4147`: synthetic 3,715-row
  invoice history; one unrelated initial batch takes 300 ms and other requests
  40 ms. Before: 599/591/593 ms. After: 331/332/331 ms. Both issue 14 requests,
  peak at seven concurrent requests, and return exactly the same 3,715 rows.
  This demonstrates removal of the serial dependency, not a production SLA.
- Compression experiment with synthetic 16,050 sales and 300 inventory items:
  gzip level 4 saved only about 1.6% versus level 1 while adding compression
  work. Compression settings remain unchanged.

Production had variable latency (some reads exceeded the earlier 4–9 seconds).
This change does not remove database/network delays; the benefit depends on
how much initial-batch latency can overlap continuation work. After publication,
measure authenticated workspace reads and repeat save/reopen checks. Publish
only the scoped optimization commit, preserving unrelated unpublished work.
