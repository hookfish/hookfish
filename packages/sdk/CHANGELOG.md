# @hookfish/sdk

## 0.3.0

### Minor Changes

- dd135f9: Remove organization routing in favor of tenant-prefixed resource paths.
  
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

## 0.2.0

### Minor Changes

- 3602b04: Describe connection providers with OAuth or secret authentication and a small
  input schema, accept generic non-secret connection configuration, and generate
  the updated SDK contract. New projects now include only the generic MCP and
  secret providers by default. Connection configuration and requested OAuth
  scopes are separate inputs; the legacy MCP `url` shorthand and provider
  `configurable` metadata are removed.

## 0.1.0

### Minor Changes

- 460692e: Publish the generated first-party TypeScript SDK as `Hookfish`, expose the
  broker runtime as `HookfishServer`, add stable OpenAPI operation IDs and a
  canonical SDK contract, serve Swagger UI at `/api/docs`, and generate a random
  `HOOKFISH_API_KEY` in new CLI projects and as the runtime's root credential.
- 796722e: Replace caller-defined OAuth connections and dynamic providers with one unified
  connection API. Connection paths now end in a trusted provider ID, OAuth access
  returns a fresh authorization URL whenever authorization is required, static
  secrets use the built-in `secret` provider, and dynamic MCP servers use the
  built-in `mcp` provider with connection-local configuration and client
  credentials. The SDK exposes explicit `access()` and `authorize()` operations
  that can be used directly from an MCP client's authentication provider.
  Requested and granted provider scopes are stored separately so a partial grant
  returns `scope_not_granted` instead of repeatedly restarting authorization.
  
  Upgrading intentionally drops the legacy `oauth_connections`,
  `oauth_providers`, and pending `oauth_states` data in Postgres, PGlite, and
  Durable Objects. Stored OAuth credentials and runtime provider credentials are
  not migrated, so users must authorize those connections again after deployment.
  Generic vault secrets and broker access tokens are not part of this reset.
