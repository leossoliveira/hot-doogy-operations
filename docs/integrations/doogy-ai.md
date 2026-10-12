# Doogy AI and Waste — local implementation

## WhatsApp directory

Doogy AI is restricted to owner/admin. It lists the WhatsApp sessions known to OpenClaw, not all phone contacts or all groups on the WhatsApp account. On 2026-10-11 the gateway returned four groups and three direct conversations. The live directory CLI could not query groups while the existing gateway owned the WhatsApp connection; do not start a competing connection or stop the gateway to work around this.

Local preview uses `HOT_DOOGY_OPENCLAW_SSH_HOST=vps` and the user's existing unlocked SSH identity. The directory runs a fixed read-only `sessions.list` gateway request, strips message content and session internals, and caches the result for 30 seconds. Connection failures show a stale indicator when a previous result exists.

For deployment, use `scripts/export-whatsapp-directory.mjs` on the OpenClaw host under its existing service identity. It atomically exports sanitized metadata only. Configure a periodic service to write a file readable by the app service, then set `HOT_DOOGY_WHATSAPP_DIRECTORY` to that path (default `/var/lib/hot-doogy/whatsapp-directory.json`). This exporter/timer has NOT been installed in production. Do not give the web service the OpenClaw root identity or credentials. The UI marks exports older than three minutes stale.

## Waste

Operations > Waste includes location-scoped history and a single-item entry form. Saving records the actor, date, reason, area, quantity and unit, and atomically creates a negative inventory movement. Unit conversion is validated on the server. Repeated submission of the same request ID returns the original result without another deduction; changing a previously accepted payload rejects the request.

Authorized roles: owner, admin, manager, chef, with existing MFA/location/storage checks. Anonymous execution is denied. Historical waste is excluded from inferred daily depletion because its actual movement is deducted separately.

Migration: local `20261011212134_record_waste.sql`; applied remotely as `20261011212739_record_waste` on 2026-10-11. Do not replay it. Isolated test: `supabase/tests/record-waste.mjs` using PGlite. No operational waste was created for testing.

Validation: 243 application tests, syntax/migration checks, isolated atomicity/permission/idempotency tests, local UI location/item/unit selection and live WhatsApp directory. Security advisors reported no new finding for this migration; existing findings remain outside this change.

## Conversation UI

Click a conversation to read `chat.history` (100 source entries per page), load older messages, refresh, or send text through the WhatsApp `send` method. This is OpenClaw's retained conversation, not a full phone backup. Tool results, reasoning, silent replies and non-text attachment payloads are omitted. The type dropdown was removed; search remains.

The gear opens the conversation's existing `systemPrompt` and group mention rule. Saves merge only those fields into that conversation using `config.patch` with the read revision hash. Stale revisions are rejected. Existing tool/access policies are preserved. A session-level activation override is displayed as read-only; the UI does not silently override it. Group settings and direct-chat context are supported by installed OpenClaw 2026.9.4.

Interactive calls require `HOT_DOOGY_OPENCLAW_SSH_HOST`; the metadata-only export does not support chat or settings. The server resolves the requested conversation against actual WhatsApp sessions and never accepts an arbitrary destination or RPC method from the browser. Sending uses a stable gateway idempotency key scoped to actor, conversation and request. An uncertain send retains the same text/key for retry. No real messages were sent and no live rules changed during validation. Gateway availability and its own retained idempotency state remain prerequisites for retry protection.

Validation: 248 passing application tests; live read-only history/settings verification; UI history and settings checks. Production interactive connection setup remains part of deployment, not included in this local preview.

## Production bridge

Production supports interactive calls through `HOT_DOOGY_OPENCLAW_SOCKET=/run/hot-doogy-openclaw/bridge.sock`. Install `deploy/hot-doogy-openclaw.service` and the application drop-in `deploy/openclaw-bridge.conf`. The bridge runs under the existing OpenClaw identity and exposes only directory/history/settings/send operations over a root:hotdoogy 0660 Unix socket in a 0750 runtime directory. It binds no TCP port. The restricted web process still authenticates the Supabase session and requires owner/admin; it receives no SSH keys, gateway tokens, raw configuration, arbitrary RPC or shell capability.

Each conversation is re-resolved from WhatsApp sessions. Settings patches are built server-side and limited to its prompt and mention rule. The code is loaded from the active root-owned release. `PartOf=hot-doogy.service` restarts the bridge with releases/rollbacks; the app's drop-in starts it when needed. Never make release source writable by the web user. The older metadata exporter remains an optional read-only alternative, not the production interactive path.

Deployment checks: service state, private socket permissions, directory/history/settings read as the web-service user, public authenticated API boundary, and release SHA. Sending and configuration writes are covered by isolated tests rather than posting real messages or changing live conversation rules.

## Direct agent chat

Doogy AI is a direct sidebar module. Owner/admin users also see the yellow bot launcher in the lower-right corner. Its popup has a matching bot header and editable starter questions about sales, menu margins, stock priorities and waste. Clicking a suggestion fills the composer; only Send submits it.

The `/api/doogy-ai/agent/history` and `/api/doogy-ai/agent/send` endpoints retain the existing authentication and owner/admin restriction. Session keys are derived server-side from the authenticated user's ID, with an application-specific namespace under the main OpenClaw agent. Clients cannot select another session. `chat.send` uses a stable idempotency key and `deliver:false`; replies appear in the popup rather than being sent to a WhatsApp conversation. The private bridge exposes only these two additional fixed actions. See the official [WebChat protocol](https://docs.openclaw.ai/web/webchat).

History polling runs while the popup is open; closing stops further polls, and permission/session errors stop polling. Uncertain send attempts preserve the original text and request ID for retry. Real remote history/send was not exercised during local verification; tests use a fake gateway, and the installed gateway parameter validator accepted the chat payload. The local server must be restarted to load the new API routes.

## Agents and Insights

Doogy AI now groups the English navigation entries **Agents** (the existing assistant and connected conversations) and **Insights**. The floating launcher gently hops between pauses and honors `prefers-reduced-motion`.

Insights are explicitly generated for the selected location by owner/admin users. The server reads data with the signed-in user's existing permissions, constructs bounded evidence from the report models, and submits it to an isolated OpenClaw analysis session. Evidence includes the latest seven imported sales days, leading menu items, recipe costs above the house target, recent physical counts, unpaid USD invoices and recorded waste in the last 30 days. It preserves incomplete-data qualifications and does not equate item lines with orders or recipe margin with profit. The job is scoped to the user's login session and request ID, with bounded polling and retry protection. No new database tables or permissions are required.

Returned cards must reference evidence supplied by the server and have a valid priority, finding and recommended next step. The UI labels the output as AI interpretation, shows generation time and supporting evidence, and links to the source report. It does not auto-generate on page load or invent fallback insights when the agent is unavailable. Local validation includes synthetic evidence, fake-agent tests and a successful generation through the authenticated preview on October 11, 2026. The resulting six cards included recipe-cost checks, a count discrepancy, unpaid invoices and menu sales. The latest analysis can be reopened during the login session; generation remains an explicit user action.
