# Inventory count workflow

New activity → Inventory count opens the location, supplier and storage-area filters, plus **Include Prep Recipes**. **Counted by** displays the authenticated account's registered name in the same non-editable style as Prepared by. The server resolves the name; draft submissions cannot choose another employee. Filters select whole-item totals for the chosen location, as before.

## Persistent drafts and section stock — October 19, 2026

**Start count** creates an `inventory_count_sessions` draft before opening the entry screen, including the fixed list of items and their sections. Quantities, units, item issues and count notes autosave to the database. The entry screen shows saving, saved and failed states, with a retry button. **Save & close** waits for a save and opens Inventory → History. Closing the browser after a successful autosave preserves the draft there. The creator can select **Resume** after reopening the application, including on another device. Other authorized users can see that the count is in progress; only its creator can resume it.

A per-account/per-count browser recovery copy also preserves edits awaiting acknowledgment. It is restored only when its version matches the saved draft. Optimistic versions reject changes from stale windows; requests are serialized and retries use the same request UUID. A failed save leaves the editor open and warns before browser closure. Reconnection retries pending edits.

**Mark section complete** publishes all items in that section immediately, including items temporarily hidden by search, then refreshes Inventory. Blank quantities are recorded as **zero**. Items outside the original filters and items in other unfinished sections are untouched. Editing a submitted section clears its completion state; completing it again replaces that count's observations for those items. Other counts are preserved. Notes and issues remain with the draft.

**Complete count** publishes every remaining or changed section, treats all remaining blanks in the count as zero and changes the draft to completed in the same database transaction. Unchanged sections are not republished, preserving their original stock timestamps and subsequent production calculations. A completed count has one History row with all its observations, notes and issues. Completed quantity/UOM corrections still use the existing observation editor.

Storage areas remain organizational sections; this change does not turn the existing whole-item count into an area-by-area stock ledger. Quantities use the selected configured count unit and the existing conversion/observation rules. New observation timestamps come from the server; the device offset determines the recorded local date.

## Deployment and verification

The frontend/server depend on `20261019110004_inventory_count_drafts_and_section_updates.sql`. Apply it through the authorized release workflow **before activating the new application**. It adds the session table with RLS and SELECT-only authenticated access, plus `save_inventory_count(jsonb)` for validated writes. The RPC enforces MFA, organizational roles, location access, creator identity, immutable item scope, valid units/quantities and optimistic versions. Anonymous execution and direct table writes are denied. No remote migration or operational stock write was performed during this implementation.

The isolated PostgreSQL test executes the original count command, the precise-timestamp and notes/issues migrations, and the new draft migration against synthetic dependencies. It covers persistent state, sections, zero stock, replacement, retries, atomic rollback, stale windows, creator/location checks, RLS/MFA and grants. It is not a full Supabase replay.

```sh
node supabase/tests/count-drafts.mjs /absolute/path/to/pglite/dist/index.js
```

The regular application tests cover serialization, lost completion responses, history deduplication and section completion signatures. A local browser check with synthetic API responses covers starting, autosave/close, reload, History resume, preserved quantities/notes, a searched section containing a hidden blank item, and final completion. Production data was not submitted.

Rollback: activate the previous application version, retaining the session table and all observations for recovery and audit. Do not delete partially published stock when reverting the UI.

## Earlier count records

Legacy day/period counts and precise device timestamps remain readable. The October 8 count-completion and notes/issues migrations are unchanged. Historical records without an employee keep the Not recorded label. Earlier device-only drafts (`hot-doogy.count-draft`) are not automatically submitted or converted to zero by this change; their stored browser data is left intact.
