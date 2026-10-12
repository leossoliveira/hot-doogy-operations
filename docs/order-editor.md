# Draft order editing

Edit order allows changing the identifier, products, quantities and Notes on drafts without receipts. Notes are prefilled, accept up to 4,000 characters and can be cleared. Cancel leaves the saved order unchanged.

The notes-aware RPC saves notes and lines in one transaction, checks organization, location, supplier, role, MFA and the expected update timestamp, and records previous/new notes in the order audit. Existing edit clients retain the prior RPC so they cannot clear notes accidentally.

Validation: `npm test`, `npm run check`, and isolated PGlite test `supabase/tests/order-edit.mjs` with the base order-edit migration, add/remove migration and notes migration. The SQL test covers saving, clearing, validation rollback, stale updates, authorization, audit and linked-invoice preservation.
