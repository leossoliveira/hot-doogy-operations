# Responsive layout

The frontend adapts to phones, tablets, and desktop windows without hiding business fields or requiring horizontal table/tab scrolling.

- `responsive.css` is loaded last. Shared grids, filters, actions, tabs, long descriptions, and dialogs wrap to fit their available width.
- `responsive.js` annotates the existing tables with column labels and explicit table roles. Container queries show the same rows and editable controls as cards when space is limited; no duplicate records or separate mobile calculations are introduced. Sort buttons remain available above the cards.
- Navigation becomes a drawer at 1024px and below, with an outside backdrop, close button, Escape handling, focus loop, and an inert background. Closed navigation is removed from keyboard access. Automatic data refresh pauses while the drawer is open.
- Editable controls use at least 16px on small or touch screens, preventing the usual iOS focus zoom without setting `user-scalable=no` or limiting manual zoom. Touch actions have larger targets.
- Phone dialogs use the visible viewport, including keyboard-related viewport changes. Calendars and the location picker also follow visual viewport resize/scroll. Narrow calendars move date presets above the day grid; short screens scroll vertically inside the picker.

## Verification — October 5, 2026

Used the local read-only snapshot preview (POST requests are blocked; no production records were saved).

- All 11 main routes at 320×740, 768×1024, 1024×768, and 1440×900: document width matched viewport width and table wrappers had no horizontal overflow.
- Additional mobile review at 390×844: Purchasing Usage, Planning, History, order entry and details, inventory count, supplier item editing/conversions, recipe detail and ingredient editor, Prep Planning.
- Verified numeric edits still update Planning calculations. Date ranges apply correctly and Planning retains its independent period.
- Checked login inputs at 320px, location search and calendar bounds at 844×390, and menu open/close, Escape, focus restoration, inert state, and scroll-lock release.
- Editable controls inspected on phone layouts computed to at least 16px. The viewport meta keeps manual pinch zoom available.
- Existing 67 CI tests and JavaScript syntax checks passed.

These checks use browser viewport simulation, not physical iPhone/iPad hardware. Native on-screen keyboard and Safari focus-zoom behavior should also be checked on a device during acceptance testing. No authentication, database, or calculation rules were changed.
