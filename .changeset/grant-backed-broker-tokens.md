---
'@hookfish/api': minor
'@hookfish/database': minor
---

Back named broker tokens with persisted, delegatable access grants. New token
payloads reference their grant instead of embedding resource scopes, while
revoking a named token deletes its grant and recursively revokes every delegated
descendant.

Database adapters now store child grants and their token atomically across
Postgres, PGlite, and Durable Objects.
