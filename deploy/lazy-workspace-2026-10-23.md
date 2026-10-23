# On-demand workspace loading

Startup requests `/api/data?scope=bootstrap`, which reads only the authorized locations. The initial Overview provides operational shortcuts; its existing business summary is fetched explicitly via View business summary. The navigation shell remains usable while a section loads.

Suppliers uses the catalog scope. It includes editable catalog data, units, price evidence and recipe references, but excludes sales facts, stock history, purchase orders, transfers and preparation batches. Existing financial/history screens still request the full workspace when opened. Histories are not truncated or presented as zero while unloaded. My Day uses its existing independent endpoint. Photos are not requested for bootstrap.

Scopes do not grant access: authentication, profile checks, Staff table restrictions and database RLS are unchanged. Full reads still use the existing bounded scheduler and admission controls. Scope is part of the session's in-flight identity, preventing a bootstrap result from satisfying a history request. Successful rows are not cached on the server.

Client rendering requires the scope for the selected route. Loading failures stay within the selected section, with Retry and usable navigation. Session/generation checks discard stale responses when navigating away; cross-section detail actions require complete data. Post-save deferred refresh remains intact.

Verification: 459 Node tests and syntax/migration checks pass. New browser regression holds the full-history response while testing entry, navigation and catalog editing, then exercises a failed history request and retry. Existing supplier retry/idempotency, seven save-feedback forms and count recovery browser suites pass. No database schema change.

## Startup asset consolidation

Live validation of v0.1.134 found a separate entry bottleneck: immediately reloading during the unbundled 76-module/11-stylesheet download produced HTTP 429 responses for static JS files. A subsequent single reload loaded bootstrap in 697 ms (883 encoded bytes), with its response ending 3,193 ms after navigation; no full-history API request occurred.

The app now ships one JavaScript bundle and one stylesheet at the same `/src/` base, preserving relative PDF worker/font URLs. PDF engines remain lazy imports. esbuild 0.25.12 is a pinned development dependency; production runs committed assets without installing dependencies. Source/output hashes reject stale bundles during deployment, and CI regenerates bundles to verify reproducibility. The existing network and authentication limits are unchanged. The browser regression verifies that startup requests only these two `/src/` assets.
