# Historical utilities

These one-off utilities are retained as reference and excluded from routine execution. Syntax checks still cover them.

| Utility | Required historical inputs |
| --- | --- |
| `sync-item-photo.mjs` | `app/public/data/snapshot.json` and `supplier-catalog.json` |
| `upload-product-photo-batch.mjs` | `app/audits/product-photos-2026-10-04/`, original image paths and upload credentials |
| `upload-mixed-photo-batch.mjs` | `app/audits/product-photos-mixed-2026-10-04/`, original image paths and upload credentials |
| `upload-webstaurant-photo-batch.mjs` | `app/audits/product-photos-webstaurant-2026-10-04/`, original image paths and upload credentials |
| `verify-mfa-browser.mjs` | `app/audits/cloud-integration-2026-10-05/fixtures/`, Playwright and a running test server |

Those exports are not distributed with the repository. Do not recreate empty fixtures to claim successful validation. Upload utilities write to remote Storage; review their inputs and obtain authorization for the intended upload before reuse. Browser verification mocks authentication and does not validate live enrollment.

Current portable tests live in `tests/`; the reusable isolated MFA database check remains in `scripts/verify-mfa-database.mjs`.
