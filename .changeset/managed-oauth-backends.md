---
'@hookfish/api': minor
'@hookfish/backend': minor
---

Add the OAuth-only `HookfishBackend` contract and support
`createHookfish({ backend })` as an alternative to self-hosted database and
provider configuration. Managed backends receive verified application
principals, cannot store caller-supplied static secrets, and do not mount
database-backed broker-token administration.
