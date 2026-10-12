# Recipe window and editing

Recipe cards and their editor use a centered wide modal. Ingredient and packaging details display table rows; the desktop editor places item, quantity, unit and type on each row. Smaller screens stack editing controls while keeping the detail table horizontally scrollable.

Both views use one horizontal tab strip: Ingredients, Packaging, Cost, Step-by-Step, Version history. Ingredient and packaging edits retain their original component indices across the two tabs. Changing type moves an item to the corresponding tab. Adding while Packaging is selected creates a packaging component. Cost updates from the edited component draft. Instructions and version history remain visible through the corresponding tabs.

Save new version uses the existing authenticated recipe command. It creates the next numbered draft version, copies the yield and instructions, records its edited components and retains earlier versions. Existing authorization and expected-version checks remain in effect. Duplicate save clicks are blocked; validation opens the tab containing an invalid field. The dialog remains open with the draft and an error if saving fails.

Validation: application tests and syntax/migration checks; browser verification of centered positioning, table rows, editor controls, Packaging, Cost and version-history tab navigation. Browser verification does not save synthetic changes to business recipes.
