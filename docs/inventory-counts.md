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

## Configured-unit validation fix — October 19, 2026

The editor offers all configured units with a positive conversion, while the draft and observation writers previously required `is_count_unit`. Selecting another configured unit therefore failed autosave and completion with `Invalid count item or unit`. Migration `20261019173433_inventory_count_configured_units.sql` aligns both writers with the editor while retaining item/location ownership, positive conversions, version guards and existing permissions.

Applied directly to production for the reported incident; the connector assigned the recorded version above (the empty local file was originally created by the CLI). All five existing draft state hashes and versions matched before and after application. No draft was completed, rewritten or deleted. The isolated test covers a non-default unit with factor 12, stock publication, rejection of another item's unit and zero conversion, preservation on failure, and completion. The 389 application tests and syntax/migration checks passed. No frontend deployment is needed. On the device holding unsynced changes, retry saving before closing; creators can resume existing drafts from History.

## Save and recovery reliability — October 19, 2026

The incident log contained 577 repetitions of the same item/unit validation error, with the last occurrence at 13:30:57 New York time, before the unit fix. Code review also found that the sync queue retained definitively rejected requests and replayed them before corrected input; count errors were sanitized to a generic database error (and version conflicts could mention invoices). Recovery copies with stale versions were ignored and could be overwritten by later edits. Section/count submission also replaced blank local quantities with zero before a response was received, including on failure.

The count endpoint now returns actionable, allowlisted validation errors with status 422 and count-specific version conflicts with status 409. The queue drops rejected requests but retains exact identities for network failures, timeouts and throttling. A recovered completion receipt is terminal: save/close cannot submit again to the completed draft. After an ambiguous completion, editing is frozen until retry resolves its status.

Completion blocks entirely empty counts/sections and explicitly asks before publishing blank quantities as zero, including rows hidden by search. Blank inputs remain blank after cancellation or rejection; zero conversion happens only during database publication. Existing saved quantities, notes, issues, creator restrictions and optimistic versions are preserved. Missing saved units are displayed as unavailable rather than silently replaced, and quantity conversion failure prevents unit relabeling.

Recovery compares content independently of JSON key order and validates the original item scope. Matching versions restore pending edits. Conflicting local copies are archived separately before the main cache is overwritten, and the editor offers a download for review. Storage failure is surfaced when synchronization fails. Recovery copies live on the device that holds them; this does not recover data never acknowledged by the database from a different device.

Validation: 382 application tests on the publication branch, isolated PostgreSQL draft tests, syntax/migration checks, and the synthetic browser regression in `tests/browser/count-reliability.mjs`. The browser suite now gates future releases in CI. It exercises rejected saves followed by corrected input, empty-count guards, hidden blanks, canceled/rejected publication, close/resume, archived conflicting recovery and lost completion responses. No operational count was completed or changed by these checks. This application/server update needs publication; the configured-unit database fix is already applied.

Local browser reproduction: start the app with `PORT=4196 node server.mjs`, then run `node tests/browser/count-reliability.mjs /path/to/playwright/index.mjs`. Chromium must be installed for that Playwright version; `COUNT_BROWSER_CHANNEL=chrome` uses an installed Chrome instead. API calls are intercepted with synthetic data before the page opens.
