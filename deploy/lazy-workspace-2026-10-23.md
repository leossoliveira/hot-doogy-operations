# On-demand workspace loading

Startup requests `/api/data?scope=bootstrap`, which reads only the authorized locations. The initial Overview provides operational shortcuts; its existing business summary is fetched explicitly via View business summary. The navigation shell remains usable while a section loads.

Suppliers uses the catalog scope. It includes editable catalog data, units, price evidence and recipe references, but excludes sales facts, stock history, purchase orders, transfers and preparation batches. Existing financial/history screens still request the full workspace when opened. Histories are not truncated or presented as zero while unloaded. My Day uses its existing independent endpoint. Photos are not requested for bootstrap.

Scopes do not grant access: authentication, profile checks, Staff table restrictions and database RLS are unchanged. Full reads still use the existing bounded scheduler and admission controls. Scope is part of the session's in-flight identity, preventing a bootstrap result from satisfying a history request. Successful rows are not cached on the server.

Client rendering requires the scope for the selected route. Loading failures stay within the selected section, with Retry and usable navigation. Session/generation checks discard stale responses when navigating away; cross-section detail actions require complete data. Post-save deferred refresh remains intact.

Verification: 459 Node tests and syntax/migration checks pass. New browser regression holds the full-history response while testing entry, navigation and catalog editing, then exercises a failed history request and retry. Existing supplier retry/idempotency, seven save-feedback forms and count recovery browser suites pass. No database schema change.
