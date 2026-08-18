---
'@hookfish/client': minor
'@hookfish/api': minor
'@hookfish/backend': patch
'@hookfish/auth-better-auth': patch
---

Extract the authenticated, tenant-isolated browser facade into
`@hookfish/client` and expose `createHookfishClientRoutes` so it can be mounted
at any path in a Hono application. Keep the existing API and backend entry
points as compatibility shims.
