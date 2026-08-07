# CredentialProvider & a persistent provider registry

Status: **design sketch** — not yet implemented. The interface skeleton lives in
`packages/provider/src/credential.ts`. This document scopes the abstraction and a
registry that is backed by storage rather than an in-memory `Map`, so Hookfish
can act as the credential layer for a large, dynamic catalog of MCP servers.

## Why

Hookfish today is an OAuth broker: a small, fixed set of hand-written providers
(`GitHubProvider`, `NotionProvider`, `LinearProvider`) registered in memory at
boot. Powering something like Smithery needs two things it does not have yet:

1. **A broader notion of a "credential".** Remote MCP servers authenticate in
   several ways — standard OAuth, the MCP authorization spec (discovery + dynamic
   client registration), and plain header/API-key auth where the user simply
   pastes a token. These are not different subsystems; they are one flow with
   different ends.
2. **A catalog that is data, not code.** Thousands of servers, added and removed
   at runtime, visible across every instance (including stateless Workers
   isolates). An in-memory `Map` rebuilt per boot cannot be the source of truth.

## Part 1 — `CredentialProvider`

The insight is that credentials differ along **two orthogonal axes**, not one
type hierarchy:

- **Acquisition** — how we *obtain* the secret. Every method ends the same way:
  the user visits a URL and, some steps later, a secret arrives at our callback.
  - `oauth` — redirect to an external consent screen → provider redirects back
    with a `code` → exchange it at the token endpoint.
  - `mcp-oauth` — discover the server's authorization server
    (`.well-known/oauth-protected-resource` → `.well-known/oauth-authorization-server`),
    dynamically register a client (RFC 7591), then behave like `oauth`.
  - `paste` — redirect to a Hookfish-hosted (or frontend) form; the user pastes a
    token; it arrives at our callback. The pasted value *is* the "code", with no
    external exchange step. This is how header/API-key auth becomes OAuth-shaped.
- **Application** — how the gateway *presents* the stored secret to the
  downstream MCP server. This is what "header-based auth" actually is.
  - `Authorization: Bearer <token>` — the OAuth default.
  - `X-API-Key: <key>`, any custom header, or a query parameter.

The two axes are independent: a *pasted* token may be applied as
`Authorization: Bearer`, and an *OAuth* token is applied the same way. Model them
separately and every case composes from the same parts.

```ts
type CredentialAcquisition = 'oauth' | 'mcp-oauth' | 'paste'

type CredentialApplication =
  | { in: 'header'; name: 'Authorization'; scheme: 'Bearer' } // OAuth default
  | { in: 'header'; name: string; scheme?: string }           // X-API-Key, etc.
  | { in: 'query'; name: string }

interface CredentialProvider {
  readonly acquisition: CredentialAcquisition
  readonly apply: CredentialApplication
  readonly label?: string

  // Step 1 — the URL the user visits.
  //   oauth / mcp-oauth → external consent URL (+ optional PKCE verifier)
  //   paste             → an internal "paste your token" form URL
  createAuthorization(input: CreateAuthorizationInput): AuthorizationRequest

  // Step 2 — turn what came back into a storable secret.
  //   oauth / mcp-oauth → exchange `code` at the token endpoint
  //   paste             → the value IS the secret; optionally probe to reject dead keys
  exchangeCode(input: ExchangeCodeInput): Promise<ProviderTokenResponse>

  refreshToken?(input: RefreshTokenInput): Promise<ProviderTokenResponse> // oauth kinds only
  revokeToken?(input: RevokeTokenInput): Promise<void>
}
```

`OAuthProvider` becomes the `acquisition: 'oauth'`, `apply: Bearer`
specialization of `CredentialProvider`, so existing providers keep working with
defaults. `MCPOAuthProvider` is `'mcp-oauth'`. A header/API-key server is
`acquisition: 'paste'` plus whatever `apply` descriptor it needs — and requires
almost no provider code, because its `exchangeCode` just returns the pasted
value.

### What is reused unchanged

Framing `paste` as an authorization flow means the entire spine of the broker
carries over untouched:

- the `oauth_states` state machine — CSRF binding, 10-minute TTL, single-exchange
  idempotency, replay handling;
- `connectionId` minting, folder scoping, and organization routing;
- encrypted-at-rest storage (`toStoredFields`) and the
  `GET /api/tokens/{connectionId}` retrieval path;
- scoped and delegated broker access tokens.

A pasted key is just an `oauth_connections` row with `refresh_token = null` and
`expires_at = null`.

### What is genuinely new

1. **Contract fields** — add `acquisition` and `apply` to the provider interface;
   default existing providers so nothing breaks.
2. **A `POST` collect endpoint for `paste`.** The existing callback is
   `GET /{provider}/callback?code=…&state=…`. A pasted secret must **not** ride in
   a URL (logs, `Referer`, history), so `paste` needs a `POST` route that reads
   the secret from the request *body* and then calls the existing
   `completeAuthorization(db, env, { provider, code: secret, state })` unchanged.
3. **The paste form** — a minimal Hookfish-hosted HTML page (keeps the broker
   headless-capable) or a frontend route. `createAuthorization` returns whichever
   URL.
4. **Persist `apply` on the connection** (in the existing `metadata` jsonb) so the
   gateway can build the request without consulting the registry.
5. **Frontend** — render a paste form vs. an external redirect based on
   `acquisition`.
6. **Gateway** — one generic "apply this credential" helper driven by `apply`.

### Security notes

- The pasted secret travels in a `POST` body over TLS only, never a query
  parameter. The callback response already sends `Cache-Control: no-store`; ensure
  the body is never logged.
- `state` still does real work for `paste`: it binds the submission to a specific
  `connectionId`, enforces the TTL, and gives single-use idempotency. Treat the
  collect URL as a short-lived bearer capability, exactly like an in-flight OAuth
  redirect.
- `exchangeCode` for `paste` may optionally probe the server (e.g. an MCP
  `initialize` handshake) so a dead key is rejected at connect time rather than at
  first tool call.

## Part 2 — A registry that is not fully in-memory

### The problem

`ProviderRegistry` wraps `new Map<string, OAuthProvider>()`. Providers are
instantiated at boot or mutated at runtime with `register()` / `unregister()`.
For a large, dynamic catalog this breaks down:

- holding every provider instance in memory is wasteful at catalog scale;
- on stateless runtimes (Cloudflare Workers) every isolate rebuilds from scratch
  and runtime `register()` mutations do not persist;
- a server added on one instance must be visible on the others;
- the catalog is user-editable, so it must live in a datastore — memory is only a
  cache.

### Separate the *definition* (data) from the *driver* (code)

A provider instance is *code + config*. At catalog scale, most providers are the
**same code parameterized by different data**:

- an `mcp-oauth` provider is fully determined by `{ serverUrl }` plus the
  endpoints and DCR client it discovers;
- a `paste` provider is determined by its `apply` descriptor (and optional probe);
- only the bespoke providers (GitHub, Notion — genuine per-vendor OAuth dialects)
  are truly code-per-provider.

So the catalog splits into two populations:

1. **Drivers** — a small, fixed set of classes compiled into the app
   (`MCPOAuthProvider`, `PasteProvider`, `GitHubProvider`, …), held in an
   in-memory driver registry keyed by a driver name.
2. **Definitions** — rows in a datastore describing each catalog entry:
   `{ slug, driver, config, secretsRef?, organization? }`. Data, persisted,
   dynamic.

A concrete provider is **driver(definition)** — materialized on demand, not held
resident.

```ts
interface ProviderDefinition {
  slug: string
  driver: string          // 'mcp-oauth' | 'paste' | 'github' | …
  config: Json            // non-secret: serverUrl, apply descriptor, discovered endpoints, DCR client_id
  organization?: string   // tenant scoping, mirrors oauth_connections
  hasSecret?: boolean      // whether an encrypted client secret exists for this slug
  createdAt: Date
  updatedAt: Date
}

interface ProviderStore {
  get(slug: string, organization?: string): Promise<ProviderDefinition | undefined>
  list(organization?: string): Promise<ProviderDefinition[]> // powers /providers
  upsert(def: ProviderDefinition): Promise<void>
  delete(slug: string, organization?: string): Promise<void>
}

type CredentialDriver = (
  def: ProviderDefinition,
  secret?: string, // decrypted client secret, when hasSecret
) => CredentialProvider
```

### The one real friction: `getProvider` is synchronous

`ProviderRegistry.getProvider(slug)` returns `OAuthProvider | undefined`
synchronously, and `resolveProviderConfig` (in `packages/api/src/oauth/config.ts`)
depends on that. A store-backed registry is inherently async. There are two ways
to bridge this:

**Option A — make resolution async.** Change `getProvider` to return a `Promise`
and `await` it in the (already-async) broker functions. Cleanest long-term, but it
is a breaking change to the `ProviderRegistry` contract and the `isProviderRegistry`
duck-type.

**Option B — request-scoped hydration (recommended).** The provider slug is always
in the route path (`/{provider}/authorize`, `/{provider}/callback`, and the token
routes carry the connection, whose provider is stored). So a middleware can read
the slug, load *exactly that one definition* from the store, materialize it with
its driver, and put a single-entry `ProviderRegistry` into the request context.
Every existing synchronous `getProvider` call then works unchanged. Only the
catalog endpoint (`GET /providers`) needs the full list, and it can query the
store directly. This keeps the blast radius to a middleware plus the store — no
change to the broker internals or the provider contract.

Because the store needs the request's database binding (`c.get('db')`), Option B
also composes naturally with the existing request-aware `DatabaseInput`
abstraction.

### Caching and consistency

- Materialized instances are cached with a short TTL and an LRU cap, bounding
  memory to hot providers.
- Invalidation on `upsert` / `delete` can be TTL-only (a catalog tolerates
  eventual consistency) or event-driven (Postgres `LISTEN`/`NOTIFY`, or a cheap
  version column). On Workers, TTL plus a per-request store read is the pragmatic
  default.

### Persisting discovery + DCR (this also fixes the Workers problem)

The earlier open issue — re-running discovery and dynamic client registration on
every Worker cold start, yielding a fresh `client_id` that cannot refresh an
older token — dissolves here. On first connect, the `mcp-oauth` driver writes the
discovered endpoints and DCR `client_id` back into the definition's `config`, and
the `client_secret` into encrypted storage. Every later boot reads them from the
store instead of re-registering.

### Storage and secrets

A `provider_definitions` table alongside `oauth_connections`:

```
provider_definitions(
  organization           text,          -- nullable; tenant scoping
  slug                   text,
  driver                 text not null,
  config                 jsonb not null default '{}',  -- non-secret
  client_secret_encrypted text,         -- optional DCR/static client secret
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  primary key (organization, slug)
)
```

Reuse the existing `encryptSecret` / `decryptSecret` (`oauth/crypto.ts`) for
`client_secret_encrypted`. Three tiers of data, kept distinct:

- **`config` jsonb** — non-secret provider metadata (serverUrl, `apply`
  descriptor, discovered endpoints, DCR `client_id`). Safe to cache.
- **`client_secret_encrypted`** — provider/client-level secret, decrypted only at
  use.
- **`oauth_connections` encrypted columns** — the end user's tokens. Unchanged.

`(organization, slug)` as the primary key lets each tenant carry its own catalog,
mirroring the organization routing already applied to connections.

## Backwards compatibility

- `OAuthProvider` is preserved as the `oauth` / Bearer specialization of
  `CredentialProvider`; the three existing providers need no changes.
- The static in-memory `ProviderRegistry` keeps working. A store-backed registry
  is opt-in: pass a `ProviderStore` instead of (or in addition to) a static
  provider map, and mount the hydration middleware.

## Open questions

- Hosted paste page vs. frontend-rendered form? (Leaning hosted, for the
  headless/Worker story.)
- Collapse `mcp-oauth` into `oauth` behind a discovery flag, or keep it a distinct
  acquisition kind? (Distinct reads clearer.)
- Do pasted tokens ever take a user-supplied expiry, or always `null` + re-paste
  on 401?
- Registry consistency: TTL-only vs. an explicit invalidation channel.
