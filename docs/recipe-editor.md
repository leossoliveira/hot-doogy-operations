# Recipe window and editing

Recipe cards and their editor use a centered wide modal. Ingredient and packaging details display table rows; the desktop editor places item, quantity, unit and type on each row. Smaller screens stack editing controls while keeping the detail table horizontally scrollable.

Both views use one horizontal tab strip: Ingredients, Packaging, Cost, Step-by-Step, Version history. Ingredient and packaging edits retain their original component indices across the two tabs. Changing type moves an item to the corresponding tab. Adding while Packaging is selected creates a packaging component. Cost updates from the edited component draft. Instructions and version history remain visible through the corresponding tabs.

Save uses the existing authenticated recipe command. It creates the next numbered active version and archives the previous active version, copies the yield and instructions, records its edited components and retains earlier versions. Existing authorization and expected-version checks remain in effect. Duplicate save clicks are blocked; validation opens the tab containing an invalid field. The dialog remains open with the draft and an error if saving fails.

Validation: application tests and syntax/migration checks; browser verification of centered positioning, table rows, editor controls, Packaging, Cost and version-history tab navigation. Browser verification does not save synthetic changes to business recipes.

The Add item button is visible only on Ingredients and Packaging, including keyboard tab changes. Switching to Cost, Step-by-Step or Version history hides the catalog picker. Editor rows use the original alignment and omit component Notes from the visual form; stored notes remain part of the versioned component. Save uses the green confirmation style. Cost metrics stay in one horizontal row for each location, with horizontal scrolling on narrower screens.

Cost displays Total Cost, Selling Price, Optimal Price, Food Cost %, Gross Profit and Gross Margin. Net Profit and Net Margin are omitted.

The remove icon appears at the end of each ingredient or packaging row. Cost headings omit the USD label; monetary values keep their dollar formatting.

Component rows show the internal name in bold, then SKU and the corresponding supplier product description. Quantity column headings and values are centered in the recipe card.

Activation on Save is enforced by the recipe_edits_activate_new_version migration. Existing drafts remain unchanged; subsequent saves become Active. Isolated PostgreSQL validation covers active/archived statuses, preserved yield and steps, optimistic version checks, rollback of invalid components and role denial. Rollback requires a new migration restoring the previous recipe edit command; historical migrations must not be replayed.

Cost Info displays Ingredients + Packaging = Total Cost, followed by Ingredients ÷ Food Cost Target + Packaging = Optimal Price. Suggested price applies the target only to ingredients and adds packaging at cost. Existing sales price and gross metrics remain below the equations.
