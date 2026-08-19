---
'hookfish': minor
---

Add the repository's authenticated Node BFF and route frontend development
through it instead of the raw Hookfish backend. The BFF mounts Better Auth and
the tenant-isolated client facade without exposing raw broker routes.
