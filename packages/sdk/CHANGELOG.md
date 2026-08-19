# @hookfish/sdk

## 1.2.0

### Minor Changes

- 5f1c29e: Create authenticated GitHub and Streamable HTTP MCP clients with
  `hookfish.github(connection)` and `hookfish.mcp(options)`. Hookfish injects
  connection credentials and handles fresh authorization after an upstream MCP
  `401`. Callers can provide an unconnected MCP `Client` when they need custom
  capabilities or client options. Returned MCP clients support `await using` for
  automatic cleanup.
- ad10b9a: Make `HookfishServer` directly mountable as a Hono sub-application and preserve
  SDK error responses through Hono's default error handler. Generate Hono-based
  Node, Docker, and Vercel starters that mount `HookfishServer` directly.

## 1.1.0

### Minor Changes

- 8c7c612: Publish compiled JavaScript instead of TypeScript sources.
  
  Every package now ships `dist` with declarations and source maps, and `exports` resolves there. Node loads them directly — `node app.ts` no longer fails with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, and no `tsx` loader is required to import a Hookfish package.
  
  `@hookfish/api` is the one exception: it serves JavaScript from `dist` but keeps `types` pointing at its sources, because instantiating its full OpenAPI route type from an emitted declaration file exhausts the TypeScript compiler's stack in `@hookfish/hooks`.
  
  `@hookfish/hooks` gains explicit return types on its hooks and option builders, which declaration emit requires. `HookfishHooks` is now written out rather than inferred, and the query option helpers return `UseQueryOptions`/`UseMutationOptions` without TanStack's internal `DataTag` branding.

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
