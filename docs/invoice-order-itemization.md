# Invoice-generated order itemization

The invoice draft functions used to copy only lines with a recognized inventory item and unit. Historical imports also created order headers without copying invoice lines. As a result, a paid invoice could have an apparently empty order.

Migration `20261022025919_preserve_invoice_order_items.sql` preserves every invoice line on its generated order, including unmatched products, services, credits and absent quantities. The order keeps the source description, SKU, unit, price and printed line total. `source_invoice_line_id` supplies a unique, tenant-checked relationship. A unique supplier SKU or exact unique supplier description may identify a product; units still require an exact recorded match. Ambiguous matches remain unresolved.

The save/edit RPCs use the common invoice-line trigger rather than inserting a second copy. Existing matching order-line IDs are adopted one-to-one so receipt references survive. Editing a draft continues to replace its draft lines through the existing authorized workflow. Explicitly linked ordinary orders are not populated by this trigger. Invoice deletion detaches the source reference and preserves the order's saved description. No new security-definer function or public grant was added.

Generated order numbers use the invoice number without adding `INV-`. Draft reuse and approval recognize that same identifier.

The application displays unmatched descriptions and marks catalog matching as pending. Stock receipt requires an identified item, unit and positive quantity; a database trigger also enforces this for invoice-sourced order lines. Credits are displayed without a receiving action. Invoice-sourced totals preserve the printed amount, including rounding; ordinary orders retain quantity-times-price estimates.

## Production repair, October 21, 2026

The migration was created with Supabase CLI 2.120.0, validated with synthetic PGlite records, simulated against production in a rolled-back transaction, and applied with the user's request to fix existing orders and their creation path. The local SQL matches the applied migration's stored statement exactly. Existing authorization, MFA, human approval, document verification and payment guards are retained.

198 linked invoices with no saved itemization were recovered from their existing original attachments: 147 from text tables with reconciled item subtotals, and 51 through direct reading of source text or visual review of locally rendered PDFs. Recovery inserted 2,641 invoice lines and corresponding order lines. The original attachments were read locally; no external analysis model was used. Business exports and credentials are excluded from this repository.

Each recovered invoice has an `invoice_itemization_recovered` audit entry with the method and line count. The repair did not post receipts, change payment state, change invoice header amounts or add inventory movements. Source document/header discrepancies remain available for separate financial review.

All active generated orders with an explicitly linked invoice have saved lines, with no omitted source lines. Order `1872502` at Natick Mall has no linked invoice; the invoice with the same number belongs to Sherwood Plaza. Do not copy across stores or change the invoice's linkage without identifying the correct source. The previously cancelled `7439493` also has no invoice and was preserved.

## Validation

Run the normal application checks and tests, then the isolated database regression:

```sh
PGLITE_MODULE_PATH=/path/to/pglite/dist/index.js \
INVOICE_ORDER_MIGRATION=supabase/migrations/20261022025919_preserve_invoice_order_items.sql \
node supabase/tests/llm-invoice-drafts.mjs \
  supabase/migrations/20261011172215_llm_invoice_drafts_human_approval.sql
```

Tests cover mapped/unmapped lines, unique-name and ambiguous matching, missing quantities, prefix-free create/edit/approval, idempotent adoption without changing existing IDs, cross-order rejection, receiving guards, existing MFA/approval checks and zero receipt/stock writes. `tests/invoice-order-lines.test.mjs` covers projection, escaping, displayed totals and unavailable receiving actions.

## Rollback

Restore application code first if required. Preserve the additive columns, recovered itemization, audit entries and existing receipt references. A database rollback needs a separate reviewed migration restoring the prior RPC definitions and removing the new triggers; do not replay historical migrations or delete recovered lines automatically.
