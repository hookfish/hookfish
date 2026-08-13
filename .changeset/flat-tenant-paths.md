---
'@hookfish/api': minor
'@hookfish/database': minor
'@hookfish/sdk': minor
'hookfish': minor
---

Remove organization routing in favor of tenant-prefixed resource paths.

The broker now exposes only the global connection and secret routes. Put a
tenant identifier in the namespace, such as `organizations/acme/**`, so broker
scopes and storage use the same boundary. The `organizationRouting` config
option, SDK `organization` option, organization-prefixed generated operations,
event field, database context, and organization persistence fields have been
removed.

The SQL migration moves organization-routed data below
`organizations/{organization}`. Existing tokens scoped to the old unprefixed
paths no longer match migrated resources, so mint replacements with
tenant-prefixed scopes after upgrading. Resource paths now allow 768 characters
so migrated paths remain addressable. Deployments that selected one Durable
Object per organization must consolidate those objects into the broker's
configured database before upgrading.
