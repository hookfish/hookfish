# @hookfish/hooks

## 0.3.2

### Patch Changes

- Updated dependencies [dd135f9]
- Updated dependencies [7f7dcc6]
  - @hookfish/api@0.6.0

## 0.3.1

### Patch Changes

- Updated dependencies [3602b04]
  - @hookfish/api@0.5.0

## 0.3.0

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

- Updated dependencies [460692e]
- Updated dependencies [796722e]
  - @hookfish/api@0.4.0

## 0.2.0

### Minor Changes

- 397067d: Add lazy provider sources with per-provider resolution and optional flexible listings that accept arbitrary query parameters and pass pagination metadata through.

### Patch Changes

- Updated dependencies [397067d]
  - @hookfish/api@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [ecb9904]
  - @hookfish/api@0.2.0

## 0.1.1

### Patch Changes

- Republish packages with resolved workspace dependency versions.
- Updated dependencies
  - @hookfish/api@0.1.1

## 0.1.0

### Minor Changes

- 9dafc45: Prepare the initial public release of the Hookfish packages.

### Patch Changes

- Updated dependencies [9dafc45]
  - @hookfish/api@0.1.0
