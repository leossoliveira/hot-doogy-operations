# HR

HR includes Team members, Permissions, Workday and Payroll. All screens and APIs are restricted to owner/admin; database reads and the save RPC require an active administrator and MFA. No credentials or account creation are handled in HR.

Team members contain personal contact fields, status, assigned locations, a system permission preset, primary job and one USD hourly wage. Creating a personnel record does not grant a login. Permissions can link an existing active account and explicitly apply a supported role and locations. Owner accounts and self-edits are prohibited; only owners may grant or alter administrator access. Administrators have organization-wide access regardless of assigned HR locations. Marking a personnel record inactive does not disable the linked login; authentication membership remains managed independently.

Workday records a date, employee, location, total paid hours and draft/approved/void status. There is no separate overtime input, monthly salary or tips in this phase. New entries use one hourly rate; the legacy overtime fields remain for compatibility with saved records. Rates are copied from the employee when an entry is created and remain immutable on subsequent edits. The server locks the employee while saving and enforces a maximum of 24 non-void hours per calendar date across locations. Users enter paid hours after unpaid breaks; this phase is a daily hours register, not a punch clock.

Payroll displays total hours and totals approved entries only: total hours × saved hourly wage. Previously saved rate components remain intact for historical records, and their hours are combined in the display and CSV export. It supports dates, location and employee filters and CSV export. Drafts/voids are excluded. This is an hourly labor cost report, not payment processing, tax withholding or a compliance determination.

Every save uses optimistic versions and writes an administrator-only audit log. No direct INSERT/UPDATE/DELETE grants are given to authenticated users. RLS blocks non-administrators, unverified MFA and other organizations. Existing records are edited or marked inactive/void rather than deleted.

## Database and verification

`20261012005936_hr_team_workday_payroll.sql` was created with the Supabase CLI (initial local timestamp 20261012005304), validated in isolated PGlite, then applied to the connected project on October 11, 2026 (America/New_York). Its filename matches the registered remote version. The remote verification found both tables empty, RLS enabled, anonymous RPC execution denied and authenticated direct writes denied. No team member, workday or account assignment was created during production verification.

Run isolated checks with:

```
PGLITE_MODULE_PATH=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/hr.mjs supabase/migrations/20261012005936_hr_team_workday_payroll.sql
```

The tests cover saves, preserved rates, stale writes, tenant/location constraints, hours limits, future dates, access assignment, MFA/staff denial, audit and anonymous denial. `tests/hr.test.mjs` verifies payroll arithmetic and server/route access guards. The SQL harness uses synthetic authorization helpers and is not a full production Auth integration test.

Rollback: hide the HR navigation/API first; preserve both tables and audit records. Revoke execution on hr_save and SELECT on the two tables to disable use without deleting personnel or hours. Do not automatically drop tables after they contain records.

Security advisor review: the authenticated SECURITY DEFINER warning for `hr_save` is intentional: this RPC is the sole write boundary and checks authenticated identity, MFA, organization role and each target before mutation. Direct table writes are revoked. See [Supabase's advisory guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Other notices concerned pre-existing objects and Auth configuration; this change does not modify them.

## Supabase user linking — October 11, 2026

The authenticated `hr_user_directory` RPC returns only accounts belonging to this organization, with email, role and assigned locations. HR never exposes credentials or other organizations' Auth users. `hr_import_users` imports those accounts into personnel records, using a unique organization-member link. Existing links are skipped; a single unlinked exact-email match is linked while retaining personnel and compensation fields. Ambiguous matches are skipped for review. Import never changes an account's system permissions. The operation uses an advisory lock and audit events.

Migration `20261012010924_hr_link_supabase_users.sql` (CLI-created original timestamp 20261012010701) was validated in isolation and applied to the connected project. The user-authorized import was then run from the authenticated preview: five workspace accounts were linked. Unknown names, jobs and rates remain null; email identifies unnamed records. New workdays are blocked until job and both hourly rates are provided. Team contact edits do not change the Auth login email. `Import users` can be repeated to discover new accounts without duplication; it does not overwrite existing personnel records.

The HR toolbar uses the shared single-date/date-range picker and checkbox multi-select in Workday and Payroll. All HR table headers are uppercase. The isolated test accepts the linking migration as an optional second migration argument and additionally verifies repeat imports, account scoping, missing-rate rejection and staff denial of account directory/import access.
