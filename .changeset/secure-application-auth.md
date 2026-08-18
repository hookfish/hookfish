---
'@hookfish/api': minor
'@hookfish/client': minor
'@hookfish/browser': minor
'@hookfish/hooks': minor
'hookfish': minor
---

Keep the raw broker API-only; add a separately mounted Hono client app and a
TanStack Router browser package; compose both in a TanStack Start frontend with
Better Auth; preserve canonical base paths; and make root or downscoped tokens
drive the browser view without exposing them to browser code.
