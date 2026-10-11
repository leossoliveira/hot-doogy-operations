# OpenClaw invoice analysis

Production rollout authorized October 11, 2026. Dedicated invoice-analysis agent, no tools, loopback-only gateway, URL fetching disabled. Backend credentials are outside the repository in /etc/hot-doogy/openclaw-invoice.json (0600, hotdoogy owner); no token is delivered to browsers.

Verified against installed OpenClaw 2026.9.4: synthetic PDF, PNG and complete six-page PDF, including all six items and matching total. The request requires type=message in its input envelope. PDF limit raised from four to twenty pages, text cap 120000; upload max 5 MB. Extraction must declare document_complete=true; human review remains necessary because model completeness is not a deterministic guarantee. Unsupported, uncertain, low-confidence and incomplete outputs fail closed.

Invoice creation saves a review draft. Humans can edit supplier, location, order, dates, financial values, notes, terms, address and all line items. New unlinked invoices create draft orders tagged From Invoice. Approval requires original verified storage document and human confirmation, with Paid/Unpaid selection and payment date when paid. No receiving or inventory operations occur in this workflow.

Migration creation timestamps 20261011143934 and 20261011171234; filenames follow actual applied versions 20261011172215 and 20261011172226. Isolated PGlite tests cover permissions, MFA, original hash, duplicate prevention, draft editing/stale protection, order synchronization, approval, payment date/method, zero inventory writes. Existing records unchanged.

Analysis requests start fresh sessions. OpenClaw may retain analysis output and image inputs in its private session records; no zero-retention guarantee. PDF extracted text is ephemeral according to the installed gateway documentation. Receiving proofs are never attached to business invoice storage.

Operational config: hot-doogy service drop-in openclaw-invoice.conf; nginx proxy read timeout 150s for analysis requests (adapter timeout120s). Rollback: revert app release, remove service drop-in and reload/restart service; retain additive database columns/audit history. Do not reset database or delete existing business records.

Protocol: https://docs.openclaw.ai/gateway/openresponses-http-api
