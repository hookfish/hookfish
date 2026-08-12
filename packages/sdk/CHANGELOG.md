# @hookfish/sdk

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
