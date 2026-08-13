---
'@hookfish/api': major
'@hookfish/database': major
'@hookfish/sdk': major
---

Remove the generic secret vault. The `/api/secrets` routes, the `hookfish.secrets` SDK namespace, the `putVaultSecret`/`getVaultSecret`/`listVaultSecrets`/`deleteVaultSecret` database methods, and the `secret.stored`/`secret.retrieved`/`secret.deleted` events are gone. Store credentials through the generic `secret` connection provider and read them with `connections.access()`. The `vault_secrets` table is dropped by Postgres migration `0011` and Durable Object schema version 4.
