# Deployed Edge Functions

`invoice-s3-confirm/index.ts` was retrieved from project `kfnsfnytnnpwptklmbip` on October 7, 2026 using the Supabase connector. It is an unchanged recovery copy, not a new deployment. The deployed function has JWT verification enabled and uses `@supabase/supabase-js@2.57.4`.

When rebuilding a project, deploy this function with JWT verification enabled and provision the destination project's managed `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Never commit the secret values. A local commit or source backup does not deploy this function.

## careers-submit

`careers-submit/index.ts` receives job applications from the public careers site (separate repository `hot-doogy-careers`, hosted on its own subdomain). Deployed on October 16, 2026 with JWT verification **disabled** — applicants are anonymous — and it uses the managed `SUPABASE_SERVICE_ROLE_KEY` to call `careers_submit` / `careers_attach_file` and upload to the private `careers-uploads` bucket. Configure `CAREERS_ALLOWED_ORIGINS` (comma-separated origins, default `*`) and optionally `CAREERS_IP_SALT` as function secrets. Reviewed in Operations under Team → Careers; see `supabase/migrations/20261016132000_careers_applications.sql`.
