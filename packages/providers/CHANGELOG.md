# @hookfish/providers

## 0.2.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [796722e]
  - @hookfish/provider@0.3.0
  - @hookfish/provider-mcp@0.2.0
  - @hookfish/provider-github@0.1.3
  - @hookfish/provider-linear@0.1.3
  - @hookfish/provider-notion@0.1.3

## 0.1.3

### Patch Changes

- Updated dependencies [397067d]
  - @hookfish/provider@0.2.0
  - @hookfish/provider-github@0.1.2
  - @hookfish/provider-linear@0.1.2
  - @hookfish/provider-mcp@0.1.3
  - @hookfish/provider-notion@0.1.2

## 0.1.2

### Patch Changes

- Updated dependencies [e62a4cc]
  - @hookfish/provider-mcp@0.1.2

## 0.1.1

### Patch Changes

- Republish packages with resolved workspace dependency versions.
- Updated dependencies
  - @hookfish/provider-github@0.1.1
  - @hookfish/provider-linear@0.1.1
  - @hookfish/provider-mcp@0.1.1
  - @hookfish/provider-notion@0.1.1

## 0.1.0

### Minor Changes

- 9dafc45: Prepare the initial public release of the Hookfish packages.

### Patch Changes

- Updated dependencies [9dafc45]
  - @hookfish/provider@0.1.0
  - @hookfish/provider-github@0.1.0
  - @hookfish/provider-linear@0.1.0
  - @hookfish/provider-mcp@0.1.0
  - @hookfish/provider-notion@0.1.0
