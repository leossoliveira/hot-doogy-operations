# Reports

Reports is a separate sidebar module with a catalog and 18 individual routes. It uses the existing authenticated data feed and does not add database queries, mutations or migrations. Staff cannot access the catalog or report routes.

## Available models

- Sales: daily sales by location, product mix and ABC, hourly/weekday sales, customer-order/average-ticket readiness.
- Costs: current food cost and theoretical margin, theoretical ingredient usage, actual COGS readiness with recorded consumption details, profit-and-loss readiness.
- Purchasing: invoice-line purchases, supplier price changes, accounts payable, orders/receiving and recorded supplier payments.
- Operations: completed physical counts/variances, production output attainment, interstore transfers, recorded waste and replenishment estimates.

The report catalog and computations live in `src/reports-model.js`; UI/filter state lives in `src/reports-ui.js`. Existing recipe-cost, purchasing-demand and financial-status rules are reused.

## Filters and output

Each report preserves its own filters during the browser session. Date-enabled reports use the shared calendar with Single date and Date range modes. Filter names appear inside their controls, Item precedes Category, and reports have no search field. The top-bar location filter applies to every report; transfers match either origin or destination. Compatible reports expose supplier, item, category, area, status, destination, reason, payment method, weekday or hour. Accounts payable supports invoice-date or due-date filtering.

Date boundaries are inclusive calendar dates in America/New_York. A missing boundary is open-ended. Usage and replenishment require both boundaries because their estimates need a defined sales period. Food cost uses the current catalog and latest displayed recipe version, and deliberately does not offer historical date filtering. Production uses completion dates for completed batches and creation dates for other batches. Missing reporting dates remain visible without date filters and are excluded, with a count notice, when dates are selected.

Tables provide sortable columns, 25/50/100/all pagination, CSV export of all matching rows, and printing of all matching rows. CSVs preserve numeric values, unknown cells, formula-injection protection, applied filters, data timestamp and coverage notes. Numeric values display in US format; the operation uses USD. Unit-specific quantities are never summed across incompatible items or packs.

## Interpretation limits

- Imported sales lines are not customer orders. Customer-order and average-ticket calculations remain unavailable until a verified order-level feed is integrated.
- ABC uses the selected population's net sales, across selected locations. It is withheld if any product total is unknown/negative or the overall total is nonpositive.
- Food-cost margin excludes operating expenses. The latest displayed recipe can be a draft; its status and version are included. The target matches the existing Food Cost screen (25%).
- Purchasing reports use invoice lines, exclude canceled/draft invoices, preserve signed credits and do not allocate header taxes/fees to items.
- Price comparisons normalize current unit conversion factors and compare the preceding approved price in the same location scope. Historical pack sizes need verification. Shared prices appear once for a selected location.
- Paid invoices without payment dates are excluded from dated supplier-payment reports. These reports show invoice totals, not verified bank transactions, partial payments or a complete cash-flow statement.
- Inventory reports show completed count history and recorded expected quantities, not a verified live balance.
- Receiving comparisons use explicit matching-unit receipt evidence; absent evidence is not proof of nondelivery.
- Production attainment is actual output / planned output, not ingredient conversion yield.
- Waste reports cover recorded events only. Missing costs stay unknown.
- Replenishment uses sales-derived demand less last physical count, with zero safety-stock allowance, converted to ordering units. It is not a minimum-stock policy. Shared supplier items repeat demand, and counts can be stale.
- Actual COGS and P&L remain readiness reports until inventory/cost reconciliation and operating expenses are available. Consumption movement costs are not blindly summed, avoiding production/sales double counting.

## Validation

`tests/reports.test.mjs` covers New York date boundaries, sales aggregation, signed credits, missing amounts and dates, price-unit normalization, receiving evidence, counts, supplier demand/pack conversions, unavailable metrics, access restrictions, HTML escaping and CSV metadata/formula protection. A local browser check with synthetic data exercises all 18 routes, filters, pagination, CSV download and desktop/mobile layouts.
