---
'@hookfish/api': minor
'@hookfish/database': minor
'hookfish': patch
---

Coordinate concurrent OAuth token refreshes with renewable database leases in
the bundled PostgreSQL, PGlite, and Durable Objects adapters. Add a
`refreshCoordinator` runtime option for deployments that use another
distributed lock service.
