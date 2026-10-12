# My Day

My Day appears below Overview with Activity Board, Tasks and Procedures. The board switches between List and Kanban (To-do, Doing, Done). Both use the same stored tasks and filter by location, due-date range, assignees, status, priority and title. Overdue means a past due date on an unfinished task.

Tasks require a title, location, active Team assignee, due date, priority and status. Description and a published procedure from the same location are optional. Procedures store purpose, detailed instructions (one step per line), completion checks and draft/published state. Text is escaped, never interpreted as HTML.

Owner, Administrator, Manager and Chef can manage records within their existing location access. Staff can read their own assigned tasks and update only their status; they can read published procedures in their locations. The My Day profile settings can further restrict visibility and writes. Linking a task does not grant HR access. The directory RPC returns only ID, name, active status and accessible location IDs, excluding email, contact details and compensation.

New tables `my_day_tasks` and `my_day_procedures` use RLS, no anonymous grants and no direct authenticated writes. Guarded RPCs enforce MFA, tenant, role, location, assignee, published-procedure and optimistic-version checks and write audit records. The migration also extends the existing profile editor’s allowed module keys. It is additive and was applied to the configured Supabase project; the app update remains local until publication is authorized.

Validation:
- `npm run check` and `npm test`.
- `PGLITE_MODULE_PATH=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/my-day.mjs`: isolated synthetic database, never real personnel or tasks. Tests saves, stale edits, invalid assignment, draft procedure linkage, role/location/tenant/MFA restrictions, staff status-only edits, profile restrictions, directory privacy and audit.
- Local browser: three routes, board/list views, date filter, new-task form, assignees changing with location, procedure form. No sample records inserted into the live database.
- Remote validation: RLS enabled, anonymous reads/direct inserts denied. Advisors flag the intentionally authenticated SECURITY DEFINER RPCs; explicit checks and isolated denial tests cover those entry points. See [Supabase advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Other existing advisor notices were outside this feature.

Rollback: revert the app integration to hide the module. Retain the tables and audit history; do not drop user records. Revoke RPC execution only if intentionally disabling My Day for all users.

## Calendar and recurring tasks

Activity Board adds a monthly Calendar with previous/next month, Today, status colors and clickable tasks on their due dates. It uses the same filters as List and Kanban. The calendar uses date-only UTC arithmetic to avoid daylight-saving shifts; today follows the existing New York date helper.

New tasks can repeat daily, Monday–Friday, weekly or monthly. A required end date bounds the schedule to one year from its first due date, with at least two occurrences. The form previews the occurrence count. Monthly schedules use the original day of month, clamped to each month’s last day (Jan 31 → Feb 28/29 → Mar 31). Each occurrence starts To-do and can be edited/completed independently. Existing task edits affect only that occurrence; the form states this explicitly.

`my_day_create_series` saves the complete series in one transaction, checks the same access/assignment constraints, and uses a stable series ID to prevent duplicate creation after retries. No scheduler or browser session is needed to generate future occurrences. Metadata is added to tasks; new indexes, RPC grants and the new migration are additive. No existing task data is rewritten. Isolated tests cover leap years, daily/weekly/weekday schedules, duplicates, independent completion, insufficient dates, invalid assignment and staff denial.

My Day form and filter controls use the shared light `--line` border and focus styling rather than native black borders.
