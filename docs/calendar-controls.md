# Calendar controls

All date and date/time inputs use the shared calendar in `src/date-picker.js`, styled by `src/date-picker.css`. Rendering enhances existing native inputs so form names, ISO values, required/min/max validation, and existing business handlers remain intact. Explicit `data-date-start` / `data-date-end` selectors connect filter endpoints behind one visible Date control. Empty controls show only Date. A selected single day appears as Date · Oct 5; a range appears as Date · Sep 27 – Oct 3. Non-current years remain visible to avoid ambiguity. Invoice issue/due dates remain independent dates.

Overview and Sales open the same calendar directly. Purchasing Usage, Planning and History, and Prep Usage, Planning and Production history allow a single day or inclusive date range. Delivery, inventory-count, invoice and production fields retain their single-date meaning. Production timestamps also retain a separate time control. Selection remains a draft until Apply; filters that already have Apply date range retain that final filter action.

- Quick ranges: Today, Yesterday, This week, Last week, This month, Last month, This year, Last year, and Custom. Single-date fields offer Today, Yesterday and Custom.
- Weeks begin Sunday. Current week/month/year run through today; prior periods cover the complete period. Today follows America/New_York, independently of the device's zone.
- Click the month/year title to choose among months and navigate groups of years. Future dates remain selectable for planning and delivery.
- A range accepts the same start/end day and orders reversed selections chronologically. A new start begins a new range. Clear resets optional fields; Cancel and Escape discard the draft.
- Arrow keys move between days; Home/End move within the week; Page Up/Down change months. Tab stays within the calendar. Escape closes only the calendar when it is above a form.
- Dates inside the calendar display as mm/dd/yyyy; the closed control uses a compact U.S. month/day label. Existing full-day range conversion retains inclusive days across daylight saving transitions. No database schema, permissions or sales calculations change.

## Verification (October 5, 2026)

`npm run check` and `npm run test:ci` pass, including calendar arithmetic, leap years, year transitions, Sunday-based presets, New York midnight, reversed ranges, single days and inclusive 23/25-hour days. Purchasing and Prep model checks also pass.

Browser checks on the local read-only preview:

- Usage Last week populates September 27–October 3 and shows sales-derived usage after applying the filter.
- Planning starts independently with blank dates; a single October 2 date populates both endpoints and calculates that day's usage.
- History accepts a reversed October 3 / September 29 selection, retains dates after Cancel, and clears optional fields.
- Prep Production history commits both range endpoints together, even though its change handler rerenders immediately.
- A purchase delivery date can move into January 2027 via month/year selection; Arrow Right + Enter changes the day. Escape leaves the order form open.
- A production timestamp retains the chosen date and 2:30 PM time.
- Overview Last week shows the inclusive date label and sales totals.
- The calendar fits a 390 × 844 viewport; the temporary viewport override was reset after verification.

These checks did not save orders, batches or other business records. Publication requires the user's approval.

Follow-up verification: Purchasing Usage, Planning and History each render one Date trigger while retaining both ISO endpoints. Planning single-day selection and Usage sales calculations remain independent. Empty triggers show Date without a placeholder.
