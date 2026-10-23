# Catalog save rejection and concurrent photo traffic

## Production evidence (read-only investigation)

On October 22, 2026 at 21:59:51 America/New_York, `/api/catalog/create`
returned HTTP 502 after 1,920 ms. PostgreSQL recorded SQLSTATE `21000`,
`UPDATE requires a WHERE clause`. The stack identifies
`private.invalidate_preparation_catalog_signature`, called by the insert into
`inventory_items` in `private.catalog_create`. The transaction was rejected;
the application incorrectly treated this database error as an uncertain save.
The pending draft preserves the command ID and can be retried after deployment.

During the same period, the server logged repeated requests for the same item
photos, some taking 15–21 seconds, workspace requests taking 24–42 seconds, and
workspace batch statement timeouts. The process stayed running through this
incident; the logs do not establish a server crash. Photo traffic bypassed the
bulk read budget and ran authorization and item lookup queries for each image.
This is a load contributor; limiting it is not proof that every workspace
timeout is resolved.

## Prepared changes

- Add a new migration with an explicit primary-key predicate to the signature
  invalidation UPDATE. All cache rows, including already-null signatures, still
  increment their generation. Shared catalog invalidation, transactional rollback,
  function privileges and historical migrations are preserved.
- Propagate SQLSTATE 21000 as a confirmed rejected write, so the form retains
  its fields and becomes editable. Lost responses still replay the same request.
- Admit at most two image GET requests at a time, before their authorization
  queries. Limit waiting requests to 128, discard disconnected waiters and release
  slots on success or failure. Writes, login and workspace loading do not enter
  this queue. Every admitted request still uses live authorization and RLS.
  Images may load more gradually; overload returns 503 for excess thumbnails.

## Validation

- 457 automated tests passed, including queue limits, cancellation, failure
  cleanup and database-to-client confirmed rejection propagation.
- Isolated PGlite tests passed across 16 source tables and 64 trigger mutations,
  plus cache reuse, multiple organizations, already-null invalidation, rollback,
  engine changes and privileges. PGlite lacks Supabase's safeupdate hook; the
  test checks the installed function's explicit predicate separately.
- Isolated Chrome tests with synthetic API responses passed: confirmed rejection
  unlocks creation fields; lost response survives reload and retries identically;
  save confirmation does not wait for list refresh; late refresh preserves new
  edits; navigation through 12 modules produces no uncaught browser exceptions.
- Syntax and migration checksum checks passed.

## Release status and verification

Prepared locally only. No production SQL, application deployment or GitHub push
was performed for this fix. Publish the reviewed fix on the current remote main
history, without including unrelated local history. The release includes migration
`20261023021423_fix_catalog_signature_safe_updates.sql` and must apply it before
activating the server change. Verify the release identity, migration checksum,
existing draft retry, and request timings/errors under actual usage after release.
No synthetic supplier or item should be created in production for verification.

If admission harms image usability, a subsequent application release may remove
or adjust the queue without reverting the database fix. Do not restore the faulty
invalidation function or delete migration history. Remaining workspace timeouts
require separate measurements if they persist after photo load is bounded.
