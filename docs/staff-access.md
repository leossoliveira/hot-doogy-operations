# Staff access

Staff is a new `member_role` value (`staff`). It does not rename or automatically convert existing employee accounts. No users or production grants are changed by the local implementation.

## Scope

- Overview: operational summary and New count; no Net Sales, sales chart or purchasing links.
- Operations: Inventory, Prep usage/history/labels and Transfers are view-only, except creating and saving Inventory Counts (including notes and item issues).
- Recipes: view recipes, components, instructions and existing cost information; no editing or photo changes.
- Purchasing, Suppliers, Invoices, Intelligence, Sales, Reports and Settings are unavailable, including direct routes, global search and direct API requests. Staff retains Account / Sign out.
- Existing organization, location, storage-area, supplier and MFA checks still apply. Assignment must include the intended `member_location_access`, `member_storage_area_access` and `member_supplier_access` records; no all-location grant is introduced.

## Enforcement

`src/access.js` defines navigation and action permissions. The server revalidates membership on every request, omits sales facts and purchasing documents from Staff data reads, and rejects API writes except a `batch` of `counts` commands. All batch entries must be counts, with no mixed or missing actions. A refreshed role is returned with workspace data so downgraded sessions update their UI.

The database enum migration commits before the permission migration. Restrictive RLS policies deny direct writes and reads outside the supporting Operations/Recipes tables, while preserving all existing scoped policies. Storage uploads/deletes are also denied. Existing privileged RPC guards continue to exclude Staff. Only the count command path is extended: every entry is checked before idempotency lookup, and `web_operation` independently permits Staff only for `counts`. The existing count validation and atomic audit transaction remain intact. The Prep usage RPC returns quantities with the existing location and MFA checks; sales monetary data remains inaccessible.

## Verification

- `npm run check` and `npm test` include Staff route/action restrictions, endpoint denial, count-only batch validation and omission of sales/purchasing reads.
- `supabase/tests/staff-access.sql` uses synthetic users and rolled-back data on an isolated local Supabase database. It tests location/tenant isolation, recipe reads, sales denial even with a permissive legacy policy, direct-write denial, blocked recipe/catalog/sales RPCs, count save + retry without duplication, mixed-batch rejection, cross-store count rejection, inactive membership, administrative MFA and anonymous denial.
- Existing `supabase/tests/access-control.sql` was rerun unchanged.
- A temporary synthetic preview verified the Staff menu, no Net Sales, recipe view without edit buttons, blocked direct Sales navigation, and count creation/completion. The real database count write was tested separately in the isolated SQL fixture; no production test count was submitted.

## Publication and assignment

Apply `20261008135853_staff_access_role.sql`, then `20261008135903_staff_readonly_permissions.sql`, only after explicit authorization and checking remote history. Deploy the application before assigning any user to Staff. Do not run the test fixtures on production. Assigning actual users requires their specific identities and intended locations.

For rollback, first revoke/deactivate Staff memberships, then restore the previous application and function definitions in a new reviewed migration. Leave the additive enum value and restrictive policies in place until all memberships are reviewed. Do not restore the old application while active Staff users remain, since its navigation does not implement Staff restrictions.
