# Recipe window and editing

Recipe cards and their editor use a centered wide modal. Ingredient and packaging details display table rows; the desktop editor places item, quantity, unit and type on each row. Smaller screens stack editing controls and fit the detail table to the available width.

Both views use one horizontal tab strip: Ingredients, Packaging, Cost, Step-by-Step, Version history. Ingredient and packaging edits retain their original component indices across the two tabs. Changing type moves an item to the corresponding tab. Adding while Packaging is selected creates a packaging component. Cost updates from the edited component draft. Instructions and version history remain visible through the corresponding tabs.

Save uses the existing authenticated recipe command. It creates the next numbered active version and archives the previous active version, copies the yield and instructions, records its edited components and retains earlier versions. Existing authorization and expected-version checks remain in effect. Duplicate save clicks are blocked; validation opens the tab containing an invalid field. The dialog remains open with the draft and an error if saving fails.

Validation: application tests and syntax/migration checks; browser verification of centered positioning, table rows, editor controls, Packaging, Cost and version-history tab navigation. Browser verification does not save synthetic changes to business recipes.

The Add item button is visible only on Ingredients and Packaging, including keyboard tab changes. Switching to Cost, Step-by-Step or Version history hides the catalog picker. Editor rows use the original alignment and omit component Notes from the visual form; stored notes remain part of the versioned component. Save uses the green confirmation style. Cost metrics stay in one horizontal row for each location, with responsive wrapping on narrower screens.

Cost displays Total Cost, Selling Price, Optimal Price, Food Cost %, Gross Profit and Gross Margin. Net Profit and Net Margin are omitted.

The remove icon appears at the end of each ingredient or packaging row. Cost headings omit the USD label; monetary values keep their dollar formatting.

Component rows show the internal name in bold, then SKU and the corresponding supplier product description. Quantity column headings and values are centered in the recipe card.

Activation on Save is enforced by the recipe_edits_activate_new_version migration. Existing drafts remain unchanged; subsequent saves become Active. Isolated PostgreSQL validation covers active/archived statuses, preserved yield and steps, optimistic version checks, rollback of invalid components and role denial. Rollback requires a new migration restoring the previous recipe edit command; historical migrations must not be replayed.

Cost metrics appear as Total Cost, Optimal Price, Selling Price, Food Cost %, Gross Profit and Gross Margin. Food Cost colors use the displayed percentage rounded to two decimals: up to 25.00% green, 25.01–25.99% yellow, 26.00% and above red. Unavailable values have no threshold color.

Cost layout has two rows: Ingredients + Packaging = Total Cost; then Optimal Price, Selling Price, Food Cost %, Gross Profit and Gross Margin. This layout does not change the pricing formula.

Responsive recipe costs wrap metrics to fit the dialog without horizontal scrolling. On narrow screens the total equation wraps its result below Ingredients + Packaging, while the remaining metrics use two columns. Recipe tabs wrap and component tables and editing controls fit the available width.

Optimal Price uses Ingredients ÷ Food Cost Target + Packaging, applying the target only to ingredients and passing packaging through at cost.

Item selection uses a single search field in new orders, existing-order editing and recipe editing. Lists remain hidden until a query is entered and match names, internal names, product descriptions and SKUs. Arrow keys and Enter select an option; Escape closes the list. A new-order line requires an actual selected catalog item rather than arbitrary typed text. Changing the query clears the prior item and unit. Search fields use a single visible border.

Item search results across orders, transfers, recipe editing, inventory, counts, supplier catalog, price updates and workspace search display a bold product description followed by `SKU · Internal name`. Missing SKUs use `—`.
