# Reports

Reports is a single direct sidebar link to a catalog with 15 operational reports and 3 legacy data-readiness routes. Individual reports are accessed through the catalog, without sidebar submenus; Reports remains highlighted while viewing a report. It uses the existing authenticated data feed and does not add database queries, mutations or migrations. Staff cannot access the catalog or report routes.

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

## Visual summaries

Every report places filters first, business metric cards next (when available), then charts and results. The generic Matching rows card and yellow coverage panel are removed. It uses all filtered rows, independent of pagination and table sorting. The chart updates with dates, locations and other filters; Clear Filters restores the defaults. Charts include focusable marks with values, tooltips (immediate hover/focus values on daily lines), and print styling. Narrow screens can scroll the plot horizontally.

| Reports | Chart |
| --- | --- |
| Sales by location; recorded supplier payments | Daily lines by location, with gaps for missing dates |
| Product mix | Top 10 consolidated menu items by net sales or items sold |
| Hour and weekday | Seven-day / 24-hour net-sales heatmap |
| Food cost | Highest known store percentage per item with a 25% house target line |
| Ingredient usage; purchase price changes | Signed percentage-change bars |
| Purchases; accounts payable; waste | Amounts by supplier, financial status or waste reason |
| Counts | Signed count-versus-expected percentage variances |
| Receiving; production; transfers; replenishment | Comparable attainment/coverage ratios with a 100% reference |
| Actual COGS readiness | Recorded-cost versus missing-cost movement counts |
| Customer orders/average ticket; P&L | Explicit unavailable state until the required data feed exists |

Unknown values are never plotted as zero. Monetary aggregation uses USD only. Shared supplier demand is deduplicated by item/location. Ratios avoid summing quantities in incompatible units; missing or nonpositive denominators are excluded. Price and count rankings retain signed changes. COGS charts measure data coverage, not cost totals. Empty reports display a no-data state without fabricated marks.

The date/location explanatory line beneath report controls has been removed. Relevant calculation caveats remain with the charts and exports. Filter-clearing actions use **Clear Filters** with the reset icon throughout Reports, Invoices, Purchasing History and Food Cost. Pagination uses **Items per page**.

## US quick-service operations review — October 2026

The catalog exposes 15 operational reports. Ticket/average-check, actual COGS and P&L readiness routes remain compatible with existing links but are removed from the catalog: verified checks, reconciled inventory valuation, payroll and operating expenses are not available. Labor %, prime cost, drive-thru service times and delivery-channel profitability must not be inferred from item sales.

PMIX consolidates the selected locations by menu item ID. Net sales and Items sold switch ranking and chart units; ABC always uses net sales concentration (80/95% cumulative boundaries), not menu-engineering profitability quadrants. CSV follows the selected ranking. Recipe cost charts show the highest known store percentage per item, with store details retained in the table. The 25% line is a house planning target, not a US industry benchmark. Production measures output versus plan, not ingredient yield. Physical count variance is not actual-versus-theoretical food cost.

USD, US dates and America/New_York sales boundaries remain in use. The navigation has one Reports entry; Sales & usage is removed from Intelligence. Chart values remain available through visible point hover/focus tooltips and the report table; the duplicate disclosure has been removed.

References used for report selection:
- Toast PMIX: https://support.toasttab.com/en/article/Product-Mix-PMIX-Report-Overview?language=en_US
- Toast report families: https://support.toasttab.com/en/article/Getting-Started-with-Analytics-and-Reports
- Restaurant365 operations reports: https://docs.restaurant365.com/docs/key-operations-reports
- Restaurant365 recipe costing: https://radar.help.restaurant365.com/support/solutions/articles/12000084054-theoretical-item-cost-by-recipe

These references guide report names and operational purpose; they do not supply HOT DOOGY financial data or benchmark targets.

## Expanded analytics and multiple selections

Toast Sales Summary and Square Sales Summary / Sales Trends informed the metric switching, time grouping, store comparisons and prior-period overlays. The implementation uses HOT DOOGY data and definitions rather than assuming that POS metrics reconcile identically.

- Daily sales: net sales, gross sales or items sold; daily or Monday-based weekly grouping; lines or grouped columns; location series or a previous equal-calendar-length period aligned by day offset. Prior-period tooltips show original dates. Edge weeks are partial. Recorded totals stay visible; growth is suppressed without complete import coverage, known values for each date/store in both periods, and a positive previous total. Missing filtered sales days remain unknown, even where they could represent zero, to avoid implying unsupported completeness.
- PMIX: top 10/20 ranking plus Pareto bars and a cumulative-share line using the complete filtered population. Nonpositive/unknown/negative populations do not get misleading cumulative percentages. Changing revenue/quantity updates both charts.
- Recipe cost: cost/price scatter plot with a 25% house target and contribution dollars; one point per item using the highest known store percentage. This is not a profitability quadrant or net-profit calculation.
- Hourly sales: heatmap plus house dayparts (overnight, breakfast, lunch, afternoon, dinner, late night), using recorded totals rather than per-day averages.
- Inventory, preparation, receiving, transfers, ingredient usage, order guide and vendor price changes: reference-dot comparisons normalized to 100%, ranked by absolute relative gap, with original quantities and units in accessible tooltips. Above/below colors indicate direction rather than good/bad performance. No aggregation of unlike units.
- Vendor purchases, supplier payments, payables and recorded waste: secondary breakdowns for purchase days, payment methods, unpaid vendors and loss days. USD only for monetary invoice aggregations; unknown values are excluded, never replaced with zero.

Item and Category use the existing searchable checkbox picker wherever those filters apply. Choices within a filter are OR; item and category filters intersect. None yields no results, All restores all options. Arrays are retained in CSV filter metadata. Filters apply to charts, metrics and rows before pagination.

References:
- https://squareup.com/help/us/en/article/5381-in-app-summaries-and-reports
- https://support.toasttab.com/en/article/Sales-Summary-Report

`tests/report-analytics.test.mjs` covers comparison completeness, calendar alignment across DST, weekly grouping, Pareto denominators, worst-store recipe selection, reference ratios and safe rendering. Report tests cover multiselection and shared page ordering.

All Report results retain tabular rows at every viewport width. The shared responsive enhancer respects `data-table-layout=rows`, so reports opt out of card conversion while preserving table roles, sorting and pagination. Narrow screens use a keyboard-focusable horizontal scroll region.

Pages with two charts use equal side-by-side panels on desktop (1200px and wider). Below that width, charts stack vertically. SVG labels and gutters adapt to the desktop columns; each chart retains its own heading and legend. Print stacks the panels.

The per-row Notes/Calculation notes/Coverage/Readiness column is excluded from report columns. Source records and report-level export metadata remain intact.

## Expanded charts

Every primary and secondary chart has an icon-only Expand chart button in its upper-right corner. The dialog shows a snapshot of that chart with its current filters, legends and point details, without the neighboring chart or report table. Close with the close icon, Escape or the backdrop; keyboard focus returns to the expansion button. Background data refresh pauses while the dialog is open. Overview and invoice-price history charts use the same control.
