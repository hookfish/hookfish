# @hookfish/api

## 0.4.0

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

### Patch Changes

- Updated dependencies [796722e]
  - @hookfish/provider@0.3.0

## 0.3.0

### Minor Changes

- 397067d: Add lazy provider sources with per-provider resolution and optional flexible listings that accept arbitrary query parameters and pass pagination metadata through.

### Patch Changes

- Updated dependencies [397067d]
  - @hookfish/provider@0.2.0

## 0.2.0

### Minor Changes

- ecb9904: Add `hookfish init` scaffolds for Vercel, Cloudflare Durable Objects, Node.js,
  Bun, and Docker, plus a standalone `hookfish serve` development dashboard that
  accepts `--backend-url`. Generated `dev:server` scripts run their platform-native
  development server, while `dev` composes that server with the Hookfish dashboard.
  The dashboard proxy preserves OAuth callback redirects so the browser returns to
  the frontend route after authorization. Dashboard authorization stays in the
  same tab so its session-scoped broker credential survives the OAuth round trip.
  Scaffolds generate a gitignored local environment with an encryption key, and
  native Node development loads that file before starting the broker.
  Publish the generic database contract and Durable Object adapter used by the
  Cloudflare scaffold.

## 0.1.1

### Patch Changes

- Republish packages with resolved workspace dependency versions.

## 0.1.0

### Minor Changes

- 9dafc45: Prepare the initial public release of the Hookfish packages.

### Patch Changes

- Updated dependencies [9dafc45]
  - @hookfish/provider@0.1.0
