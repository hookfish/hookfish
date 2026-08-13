# @hookfish/api

## 1.0.0

### Major Changes

- ee51ebd: Remove the generic secret vault. The `/api/secrets` routes, the `hookfish.secrets` SDK namespace, the `putVaultSecret`/`getVaultSecret`/`listVaultSecrets`/`deleteVaultSecret` database methods, and the `secret.stored`/`secret.retrieved`/`secret.deleted` events are gone. Store credentials through the generic `secret` connection provider and read them with `connections.access()`. The `vault_secrets` table is dropped by Postgres migration `0011` and Durable Object schema version 4.

### Minor Changes

- ee51ebd: Relicense from MIT to the Functional Source License 1.1 (Apache 2.0 future license) with an attribution requirement for end-user-facing applications. Use, modification, redistribution, and self-hosting stay permitted for every purpose except offering Hookfish as a competing commercial product or service, and each version converts to Apache 2.0 two years after release. `hookfish init` now writes the attribution note into the generated project's `AGENTS.md` and `README.md`. Releases published before this change remain available under MIT.

### Patch Changes

- d4495a1: Fix three type errors that only surfaced in consumer builds, since both packages ship TypeScript sources.
  
  - `@hookfish/api`: pin the `authentication` literals in `GET /connections/providers` so inference cannot widen them to `string`, and stop annotating two internal helpers with `CryptoKey`, which is only ambient under the DOM lib.
  - `@hookfish/sdk`: `connections.*`, `accessTokens.*` and `stats()` declared a `{ data, request, response }` envelope while resolving the bare response body. They now resolve and declare the body. Callers who worked around this by reading `.data` must read the body directly.
  - `@hookfish/sdk`: the generated client no longer references `BodyInit`, so it compiles under a Node-only `lib`.
- Updated dependencies [ee51ebd]
  - @hookfish/provider@0.5.0

## 0.6.0

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

- 7f7dcc6: Reuse a connection's stored requested scopes during explicit OAuth
  re-authorization.

## 0.5.0

### Minor Changes

- 3602b04: Describe connection providers with OAuth or secret authentication and a small
  input schema, accept generic non-secret connection configuration, and generate
  the updated SDK contract. New projects now include only the generic MCP and
  secret providers by default. Connection configuration and requested OAuth
  scopes are separate inputs; the legacy MCP `url` shorthand and provider
  `configurable` metadata are removed.

### Patch Changes

- Updated dependencies [3602b04]
  - @hookfish/provider@0.4.0

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
