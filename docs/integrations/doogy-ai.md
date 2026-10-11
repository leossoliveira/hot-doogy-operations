# Doogy AI and Waste — local implementation

## WhatsApp directory

Doogy AI is read-only and restricted to owner/admin. It lists the WhatsApp sessions known to OpenClaw, not all phone contacts or all groups on the WhatsApp account. On 2026-10-11 the gateway returned four groups and three direct conversations. The live directory CLI could not query groups while the existing gateway owned the WhatsApp connection; do not start a competing connection or stop the gateway to work around this.

Local preview uses `HOT_DOOGY_OPENCLAW_SSH_HOST=vps` and the user's existing unlocked SSH identity. The server runs a fixed read-only `sessions.list` gateway request, strips message content and session internals, and caches the result for 30 seconds. Connection failures show a stale indicator when a previous result exists.

For deployment, use `scripts/export-whatsapp-directory.mjs` on the OpenClaw host under its existing service identity. It atomically exports sanitized metadata only. Configure a periodic service to write a file readable by the app service, then set `HOT_DOOGY_WHATSAPP_DIRECTORY` to that path (default `/var/lib/hot-doogy/whatsapp-directory.json`). This exporter/timer has NOT been installed in production. Do not give the web service the OpenClaw root identity or credentials. The UI marks exports older than three minutes stale.

## Waste

Operations > Waste includes location-scoped history and a single-item entry form. Saving records the actor, date, reason, area, quantity and unit, and atomically creates a negative inventory movement. Unit conversion is validated on the server. Repeated submission of the same request ID returns the original result without another deduction; changing a previously accepted payload rejects the request.

Authorized roles: owner, admin, manager, chef, with existing MFA/location/storage checks. Anonymous execution is denied. Historical waste is excluded from inferred daily depletion because its actual movement is deducted separately.

Migration: local `20261011212134_record_waste.sql`; applied remotely as `20261011212739_record_waste` on 2026-10-11. Do not replay it. Isolated test: `supabase/tests/record-waste.mjs` using PGlite. No operational waste was created for testing.

Validation: 243 application tests, syntax/migration checks, isolated atomicity/permission/idempotency tests, local UI location/item/unit selection and live WhatsApp directory. Security advisors reported no new finding for this migration; existing findings remain outside this change.
