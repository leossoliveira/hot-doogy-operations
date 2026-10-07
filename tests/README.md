# Tests

`npm test` and `npm run test:ci` run the same automatically discovered `*.test.mjs` files. Nested test directories are supported; `historical/`, `fixtures/` and `helpers/` are excluded from discovery. Each test has a 15-second timeout.

Use synthetic, deterministic data in `fixtures/` or inline fixtures for small cases. Do not use production exports for normal tests. Workspace tests simulate browser APIs and mock all network access; they are not a substitute for a real browser smoke test.

`npm run test:historical` explicitly selects archived export-dependent tests. It fails with prerequisites if private data is unavailable. These tests preserve previous assertions; they have not been revalidated against current UI contracts and are excluded from CI. They must be reviewed before use with restored exports.

`npm run check` checks the syntax of project JavaScript (including scripts and tests, excluding vendor assets) and verifies imported migration checksums and filename uniqueness. It does not execute SQL.
