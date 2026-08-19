# hookfish

## 0.13.0

### Minor Changes

- 530b921: Replace browser broker credentials with an authenticated, tenant-isolated
  application API; add the Better Auth organization adapter; make the raw API
  server-only by default; and put the local operator dashboard behind a
  restricted loopback BFF.

### Patch Changes

- ad10b9a: Make `HookfishServer` directly mountable as a Hono sub-application and preserve
  SDK error responses through Hono's default error handler. Generate Hono-based
  Node, Docker, and Vercel starters that mount `HookfishServer` directly.
- Updated dependencies [cbb2be5]
  - @hookfish/database@1.2.0

## 0.12.1

### Patch Changes

- Updated dependencies [8c7c612]
  - @hookfish/database@1.1.0

## 0.12.0

### Minor Changes

- ee51ebd: Relicense from MIT to the Functional Source License 1.1 (Apache 2.0 future license) with an attribution requirement for end-user-facing applications. Use, modification, redistribution, and self-hosting stay permitted for every purpose except offering Hookfish as a competing commercial product or service, and each version converts to Apache 2.0 two years after release. `hookfish init` now writes the attribution note into the generated project's `AGENTS.md` and `README.md`. Releases published before this change remain available under MIT.
- ee51ebd: Scaffold Cloudflare Workers with PostgreSQL through Hyperdrive instead of the experimental SQLite Durable Object adapter.

### Patch Changes

- Updated dependencies [ee51ebd]
- Updated dependencies [ee51ebd]
  - @hookfish/database@1.0.0

## 0.11.0

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

### Patch Changes

- Updated dependencies [dd135f9]
  - @hookfish/database@0.4.0

## 0.10.0

### Minor Changes

- 3602b04: Describe connection providers with OAuth or secret authentication and a small
  input schema, accept generic non-secret connection configuration, and generate
  the updated SDK contract. New projects now include only the generic MCP and
  secret providers by default. Connection configuration and requested OAuth
  scopes are separate inputs; the legacy MCP `url` shorthand and provider
  `configurable` metadata are removed.

### Patch Changes

- @hookfish/database@0.3.1

## 0.9.0

### Minor Changes

- 835e874: Add `hookfish update` for global npm installations and warn before commands when a newer stable release is available.
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

- 460692e: Publish the generated first-party TypeScript SDK as `Hookfish`, expose the
  broker runtime as `HookfishServer`, add stable OpenAPI operation IDs and a
  canonical SDK contract, serve Swagger UI at `/api/docs`, and generate a random
  `HOOKFISH_API_KEY` in new CLI projects and as the runtime's root credential.
- Updated dependencies [796722e]
  - @hookfish/database@0.3.0

## 0.8.4

### Patch Changes

- 351638f: Remove the generated `hookfish.project.json` marker and make `hookfish dev` and
  `hookfish serve` consistently serve the packaged dashboard with an API proxy.
  Serving now requires an explicit `--backend-url` or `HOOKFISH_BACKEND_URL`.
- @hookfish/database@0.2.1

## 0.8.3

### Patch Changes

- 24c9d86: Fix Cloudflare scaffold dashboard requests by keeping the frontend origin consistent and removing stale compression headers from proxied Wrangler responses.

## 0.8.2

### Patch Changes

- 6beca47: Run the inspector directly on localhost and remove the Portless dependency so
  it no longer installs certificates, modifies the hosts file, or requires sudo.

## 0.8.1

### Patch Changes

- 120c06f: Keep generated projects on the CLI's prerelease channel and preapprove the
  required esbuild install script for pnpm.

## 0.8.0

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
- e62a4cc: Bundle the MCP inspector with the CLI so `npx hookfish inspect` and `npx hookfish inspector` start at `https://inspector.localhost` through Portless, fully stop an existing inspector before taking over its route and PGlite database, and use correct OAuth callbacks. Localhost OAuth clients now use dynamic registration so remote authorization servers can validate the inspector callback. The CLI now requires Node.js 24 or newer to match Portless.

### Patch Changes

- Updated dependencies [ecb9904]
  - @hookfish/database@0.2.0

## 0.7.1

### Patch Changes

- Republish packages with resolved workspace dependency versions.
- Updated dependencies
  - @hookfish/database@0.1.1

## 0.7.0

### Minor Changes

- 9dafc45: Prepare the initial public release of the Hookfish packages.

### Patch Changes

- Updated dependencies [9dafc45]
  - @hookfish/database@0.1.0
