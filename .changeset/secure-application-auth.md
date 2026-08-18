---
'@hookfish/api': minor
'@hookfish/backend': minor
'@hookfish/hooks': minor
'@hookfish/client': minor
'hookfish': minor
'@hookfish/auth-better-auth': minor
---

Replace browser broker credentials with an authenticated, tenant-isolated
application API; add the Better Auth organization adapter; make the raw API
server-only by default; and expose the operator-safe facade as a mountable Hono
package for a separate TanStack Start frontend.
