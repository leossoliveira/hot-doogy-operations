# Inventory count workflow

New activity → Inventory count opens an initially unselected location and required employee-name fields, the shared searchable supplier multiselect, and location-specific storage-area multiselect. Supplier selection supports All, None and multiple choices. Storage-area selection supports All, None and multiple choices. Filters select items; quantities remain whole-item totals for the chosen location.

Complete count captures the device instant, local calendar date and UTC offset. Employee Name is required and limited to 80 characters; it is a label, not the authenticated actor. Authorization and created_by remain tied to the signed-in account.

## Deployment order

Apply `20261008111849_inventory_count_device_completion.sql` through the authorized migration workflow before deploying this frontend and server. It adds nullable fields for the precise completion instant, device offset and employee name, preserves legacy day/period records, and patches only the count insert in the existing private command. No migration was applied to the remote project during local development.

## Validation

The focused test uses PostgreSQL in memory through PGlite 0.3.14. It executes the original private command and the new migration with synthetic tables and authorization dependencies. It covers the timestamp across UTC midnight, zero quantity, employee label, legacy counts, mismatched dates and rejected locations. It is not a full Supabase migration replay or a production validation.

Run with an existing local PGlite module:

```sh
node supabase/tests/count-completion.mjs /absolute/path/to/pglite/dist/index.js
```

The regular checks and application tests also run before committing. Browser verification opens the filters and item list without submitting real inventory quantities.

Items are grouped by their displayed storage area and alphabetized within each collapsible section. Mark section complete collapses that section; editing a quantity or unit clears its completion mark. Section completion is session-only review state and does not submit a count.

Starting a count opens the full-screen entry view and locks location and employee. Employee name remains required without a static helper label. The entry view removes the locked location dropdown arrow, shows ordering-to-stocktake conversions and SKU followed by the supplier catalog product description (without a description label), uses QTY. for quantities, and provides yellow section completion, green count completion, and red cancellation actions.

Count quantity fields show Est. Stock in the selected count unit, using the same latest completed count plus subsequent production reference as the inventory view. Missing or partial totals display a dash rather than zero. Changing the count unit recalculates the displayed estimate.

Count filters use consistent control heights and the native single-location dropdown. UOM fields have a uniform width. Quantity and UOM columns align across sections on desktop. Each item has an icon-only Report issue button and dialog; saving it updates the current count draft, and clearing its text removes the report. Notes at the bottom apply to the whole count. On completion, notes and issues are persisted atomically in the existing count audit record (`audit_logs.new_data`), including issues for items without an entered quantity. The new migration validates text limits and item/location scope. No separate issue notification is sent. The count completion and notes/issues migrations were applied to production on October 8, 2026. Local filenames match the versions assigned by Supabase (20261008125044 and 20261008125059); SQL contents were preserved.
