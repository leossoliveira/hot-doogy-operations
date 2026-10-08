# October 8 count area recovery

Applied `20261008234321_recover_today_count_storage_areas.sql` after explicit user request to correct today's counts. CLI originally generated version 20261008234209; filename aligned with the recorded remote migration version after application.

197 observations were inspected. 185 were linked to the sole current item/location assignment; 12 ambiguous observations remain unassigned pending user confirmation. Recovery provenance is stored separately from original entry data. This does not establish that a historic snapshot of assignments was retained.

Verified 197 observations and 13 zero quantities before and after; the checksum of observation IDs, quantities, base quantities and units was identical. No quantity, unit or inventory transaction was changed. Existing RLS/grants were unchanged.

Isolated PGlite validation verified unique-assignment recovery, exclusion of ambiguous assignments, other dates and other organizations, preservation of zero/quantities/units, and storage-area foreign key enforcement. The application suite passed 199 tests.

Recovery can be reversed by clearing only the three new area/recovery fields for observations whose recovery basis is `single_current_assignment` and whose counted date is October 8, 2026, within the same organization. Review affected rows first; do not clear subsequently confirmed links or alter quantities. Remote rollback requires an explicit request.
