# Administrative MFA

This release adds mandatory administrative MFA. The coordinated application/database deployment was authorized on October 5, 2026. Each administrator must personally complete enrollment after deployment. The deployed application version is recorded in `/opt/hot-doogy/deployed-version`; database migration history is recorded in Supabase.

Owners and admins must enroll an authenticator, then verify a six-digit TOTP code after password login. Other roles retain password login unless they already have a verified MFA factor. MFA does not grant extra roles or location access.

The browser receives an opaque HttpOnly session cookie. Access/refresh tokens stay in server memory. A pending sign-in expires in 10 minutes, the full session expires in 8 hours, and successful verification rotates the cookie. The QR code and setup key are held only in memory and sent with `Cache-Control: no-store`; never log or save them. Setup survives a browser reload by reusing the pending server enrollment. Failed code attempts are limited per user across cookies/password logins. Supabase also enforces its own Auth limits.

Every protected app API checks the active Supabase session, current membership and MFA assurance. SQL checks both JWT AAL2 and the live session's verified factor. Revoked sessions, removed factors and stale AAL1 tokens cannot satisfy MFA. Restrictive RLS policies cover existing public tables and Storage objects; the only pre-MFA business read is the user's own membership to bootstrap enrollment. The RLS MFA predicate uses an uncorrelated subquery so PostgreSQL can evaluate it once per statement. Organization/location/supplier helpers retain their original scope checks without repeating live MFA checks per row. Privileged RPC entry points explicitly enforce MFA before protected operations, including purchasing, preparation, sales imports and internal requests. Existing service-role/background operations retain their explicit trusted paths. Future tables/RPCs must use these guards too.

## Deployment order

Do not push this release with the normal unattended updater active before staging the database changes. The new server depends on `operations_auth_status` and fails closed if it is missing.

1. Obtain approval for the app release and the accompanying Supabase changes. Keep SSH, Supabase dashboard access and the current server release available. Confirm trusted platform administration and recovery access remain available independently of application login; app roles are separate from platform accounts.
2. Pause the VPS update timer. Push the approved changes, wait for CI, and stage the validated release without activating it.
3. In a short coordinated maintenance window, apply `database/security-mfa.sql`, followed by `database/security-mfa-read-performance.sql`, as tracked Supabase migrations, then immediately activate/restart the MFA-capable server. Applying SQL revokes owner/admin AAL1 data access immediately; do not leave the old UI running with the new rules. On an existing MFA deployment, apply only the performance correction; it requires no server restart.
4. Confirm API health and `operations_auth_status` permissions, run Supabase security advisors, and verify anonymous requests remain denied. Have each owner/admin sign in, personally scan their QR code and enter a real authenticator code. Confirm a fresh password login requests MFA and a pending session cannot access data or commands. No one should send their QR, setup key or current code in chat.
5. Resume the updater only after these checks. Confirm desktop/mobile login and Purchasing still work. Record the database migration and deployed Git tag.

A rollback must preserve the database MFA restrictions. Prefer fixing/rolling forward the MFA UI/server. Rolling back only the application to a password-only version will leave administrators unable to use the app; do not remove MFA checks as a shortcut. Both SQL scripts are safe to apply again in the stated order.

## Lost authenticator / recovery

There is intentionally no password-only MFA bypass and no claim that Supabase issues recovery codes for this flow. Users contact a trusted platform administrator; a second app admin cannot reset factors from this application.

1. Verify the person's identity through an established independent channel (for example in person), confirm the exact Auth user UUID, and document who approved recovery. An email request or knowledge of the password alone is insufficient.
2. Using trusted Supabase administrative tools, revoke **all** of that user's sessions before resetting the factor. Where the console has no session-revocation control, an authorized database administrator can run the following narrowly scoped SQL after replacing the UUID. This is an operational recovery action, never a client RPC:
   ```sql
   delete from auth.sessions where user_id = '<verified-user-uuid>'::uuid;
   ```
   Confirm no sessions remain for that UUID. The application's live session check immediately rejects old cookies/JWTs, rather than waiting for token expiry. If compromise is suspected, reset the password through the trusted Auth recovery process as well.
3. Remove the lost factor from that exact user's MFA settings in the Supabase dashboard (or the Auth Admin factor deletion API). Never remove factors from another user or disable project-wide MFA. Retain an audit record without secrets.
4. Have the user sign in again and personally enroll/verify a new authenticator. Owners/admins stay blocked from business data until verified. Confirm a subsequent login challenges the new authenticator and the old session remains denied.

Protect Supabase platform accounts with their own MFA; application MFA does not protect the platform dashboard. Keep recovery access independent of the application itself.

## Verification

`npm run check`, `npm test`, and `npm run test:ci` cover the application and server (MFA test cases are included in CI).

For SQL verification, install the pinned temporary test dependency outside the project and run:

```sh
npm install --prefix /tmp/hot-doogy-mfa-test --save-exact @electric-sql/pglite@0.5.8 --ignore-scripts
PGLITE_MODULE_PATH=/tmp/hot-doogy-mfa-test/node_modules/@electric-sql/pglite/dist/index.js node scripts/verify-mfa-database.mjs
```

This executes the base SQL and the performance correction's scope-helper definitions twice in an isolated PostgreSQL WASM instance and checks RLS writes/reads, tenant isolation, the membership bootstrap, Storage, an invoker view, a privileged RPC fixture with an explicit MFA guard, revoked/expired sessions, removed factors and grants. It never connects to production. The complete production RPC definitions require the application's full schema and must also be validated when applying the tracked migration.

The October 5 performance correction addresses initial workspace reads timing out after MFA. Repeated live session/factor checks inside nested scope helpers caused excessive work per row. Production validation with a verified AAL2 session successfully read all 44 initial workspace tables (up to 1,000 rows each); the slowest individual query took about 0.6 seconds. A rollback-only AAL1 probe returned zero supplier rows while preserving the user's membership bootstrap, and denied invoice approval, purchase receipt confirmation, web commands and preparation sales RPCs. These individual query timings are not an end-to-end login benchmark.

For browser checks, start `PORT=4190 node server.mjs`, then run `scripts/verify-mfa-browser.mjs` with `PLAYWRIGHT_MODULE_PATH` pointing to Playwright's `index.mjs`, and optionally `CHROME_PATH` pointing to a test browser executable. It intercepts API responses with fixtures and writes clearly labeled fake enrollment/mobile screenshots to `/tmp`. Do not use these screenshots to enroll a real account. Real provider enrollment still needs the user's phone after deployment.

References: [Supabase TOTP MFA](https://supabase.com/docs/guides/auth/auth-mfa/totp), [MFA enforcement](https://supabase.com/docs/guides/auth/auth-mfa), [Auth sessions](https://supabase.com/docs/guides/auth/sessions).
