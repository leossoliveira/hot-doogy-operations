# Inventory count workflow

New activity → Inventory count opens location and employee-name fields, the shared searchable supplier multiselect, and location-specific storage-area multiselect. Supplier selection supports All, None and multiple choices. Storage-area selection supports All, None and multiple choices. Filters select items; quantities remain whole-item totals for the chosen location.

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
