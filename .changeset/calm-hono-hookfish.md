---
'@hookfish/api': minor
'@hookfish/sdk': minor
'hookfish': patch
---

Make `HookfishServer` directly mountable as a Hono sub-application and preserve
SDK error responses through Hono's default error handler. Generate Hono-based
Node, Docker, and Vercel starters that mount `HookfishServer` directly.
