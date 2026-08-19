---
'@hookfish/api': minor
'@hookfish/database': minor
---

Back named broker tokens with persisted, delegatable access grants. New token
payloads reference their grant instead of embedding resource scopes, while
tokens issued before this change remain valid after migration. Revoking a named
token now deletes its grant and recursively revokes every delegated descendant.

Database adapters now store child grants and their token atomically. Postgres,
PGlite, and Durable Object migrations preserve existing broker tokens by
creating a root grant for each one.
