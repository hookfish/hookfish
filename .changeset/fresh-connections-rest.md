---
'@hookfish/api': minor
'@hookfish/database': minor
'@hookfish/provider': minor
'@hookfish/provider-linear': patch
'@hookfish/provider-mcp': patch
'hookfish': patch
---

Coordinate concurrent OAuth token refreshes with renewable database leases in
the bundled PostgreSQL, PGlite, and Durable Objects adapters. A rejected refresh
with `invalid_grant` invalidates the unusable credentials so concurrent waiters
share the failure, while transient provider errors preserve credentials for a
later retry. Provider request errors now carry optional HTTP status and OAuth
error details.
