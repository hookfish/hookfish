# OAuth broker

Brokers OAuth connections you manage under a **connection id**. You give it a
connection id (or let it mint one) and a **connection source** (`notion`,
`linear`, `github`, ...); it runs the consent flow, stores the tokens encrypted,
and hands back a valid access token on demand — refreshing transparently when
one is about to expire.

Each connection id is **one provider link**. Multiple accounts on the same
provider are multiple ids. Re-authorizing the same id for the same provider
upserts the stored tokens; using it for a different provider returns `409`.

## Setup

```sh
cp apps/frontend/.env.example apps/frontend/.env

# Fill in at minimum:
openssl rand -base64 32   # -> OAUTH_ENCRYPTION_KEY
openssl rand -base64 32   # -> BROKER_API_KEY
# ...plus NOTION_CLIENT_ID / NOTION_CLIENT_SECRET
```

```sh
pnpm exec hookfish dev --backend hono-node
```

The CLI runs `turbo dev` with exactly the static Vite frontend and selected
backend. Available backends are `hono-node`, `express`, `nextjs`, and
`cloudflare-worker`.
The backend exposes raw Hookfish routes at `/api` and the browser facade at
`/api/client`. Node examples persist PGlite to `pgdata`; the Worker uses local
Durable Object storage. Both read `apps/frontend/.env`; the frontend only
receives `VITE_` variables.

Then register the redirect URI in each provider's developer console. Ask the
running broker for the exact string rather than guessing it—the host depends on
how you reach the API, and providers match `redirect_uri` byte for byte:

```sh
curl -H "Authorization: Bearer $BROKER_API_KEY" \
  http://127.0.0.1:8787/api/oauth/providers \
  | jq -r '.providers[] | "\(.id)\t\(.callback_url)"'
```

## Runtime entrypoints

Each host initializes Hookfish and mounts its Fetch-compatible handler directly:

| command | process | default database |
|---|---|---|
| `pnpm exec hookfish dev --backend hono-node` | Vite SPA + Hono Node backend | `pgdata` |
| `pnpm exec hookfish dev --backend express` | Vite SPA + Express backend | `pgdata` |
| `pnpm exec hookfish dev --backend nextjs` | Vite SPA + Next.js backend | `pgdata` |
| `pnpm exec hookfish dev --backend cloudflare-worker` | Vite SPA + Cloudflare Worker | SQLite Durable Objects |
| `pnpm --filter @hookfish/example-hono-node dev` | standalone Hono backend | `pgdata` |
| `pnpm --filter @hookfish/example-cloudflare-worker dev` | Cloudflare Worker backend | SQLite Durable Objects |

Set `PGLITE_DATA_DIR` to move the embedded Node database. Providers, browser
policy, and documentation visibility live in the root `hookfish.config.ts`.
Node examples use its default database unchanged; the Worker replaces `db`
with its tenant-aware Durable Object binding.

### Configuring Hookfish

The root config owns the default database, providers, and browser policy. A
database may be a Hookfish `Database`, a promise, or a request-aware binding:

```ts
// hookfish.config.ts
import { defineHookfishConfig } from '@hookfish/api'
import { pglite } from '@hookfish/database/pglite'
import { createNotionProvider } from '@hookfish/provider-notion'

type Bindings = {
  NOTION_CLIENT_ID?: string
  NOTION_CLIENT_SECRET?: string
}

export default defineHookfishConfig<Bindings>({
  db: pglite(process.env.PGLITE_DATA_DIR ?? './pgdata'),
  // Mount the browser-safe facade at /api/client:
  includeClient: true,
  // Include server-only routes in /api/openapi.json. When false, the same
  // Swagger UI and document expose only client-safe routes:
  includeSwagger: true,
  // Override the default development completion page before deploying:
  // returnTo: 'https://app.example.com/settings/integrations',
  // Permit per-flow return_to paths on these application origins:
  // trustedOrigins: ['https://app.example.com'],
  // Prefix OAuth management routes with
  // /api/organization/:organization/oauth while
  // retaining one global provider callback URL:
  // organizationRouting: true,
  // Receive best-effort lifecycle events for audit or telemetry export:
  // onEvent: async (event) => auditLog.write(event),
  providers: (env) => ({
    notion: createNotionProvider({
      clientId: env.NOTION_CLIENT_ID,
      clientSecret: env.NOTION_CLIENT_SECRET,
    }),
  }),
})
```

Hookfish reads its conventional `OAUTH_ENCRYPTION_KEY`, `BROKER_API_KEY`,
`OAUTH_REDIRECT_BASE_URL`, and `NODE_ENV` settings lazily when an OAuth request
arrives. Request bindings take precedence over the ambient Node environment;
an operation that needs a missing broker secret returns `500
missing_configuration`.

Provider factories receive the bindings passed to `hookfish.fetch` and may
return a map immediately or asynchronously. They run once for each request
that needs providers, so Worker secret rotations do not leave stale provider
clients in an isolate. A static provider map and an existing
`ProviderRegistry` are resolved once when providers do not depend on runtime
bindings. Hookfish validates its own broker settings; provider binding types
and any additional validation belong to the host application.

Production deployments must set `OAUTH_REDIRECT_BASE_URL`; development and test
instances may derive it from the incoming request origin. This keeps registered
callback URLs independent of forwarded or untrusted Host headers.

Fetch entrypoints initialize Hookfish and the backend once. If a Node host loads
an env file itself, it does so before dynamically importing the config:

```ts
import { Hookfish } from '@hookfish/api'
import config from '../../../hookfish.config'

const hookfish = await Hookfish.init(config)

export default { fetch: (request) => hookfish.fetch(request, process.env) }
```

Hosts can replace the configured database without changing anything else:

```ts
import { Hookfish } from '@hookfish/api'
import config from '../../../hookfish.config'
import { durableObjects } from '@hookfish/database/durable-object'

const db = durableObjects((env: Env, context) =>
  env.HOOKFISH_DB.getByName(context.organization ?? '__global__'),
)
const hookfish = await Hookfish.init<Env>({
  ...config,
  db,
})
```

`pglite()` initializes lazily and applies the bundled migrations once.
`postgres()` accepts either a URL or a resolver called with the bindings passed
to `Hookfish.fetch(request, bindings)`. `durableObjects()` resolves a typed RPC
stub for the current request. On organization-scoped routes,
`context.organization` is the validated organization path parameter, allowing
one named object per organization and a reserved object for global routes.

The Durable Object adapter applies its SQLite schema lazily when each object
starts. `pnpm migrate` continues to migrate the Node/PGlite database;
`pnpm migrate --backend cloudflare-worker` reports that no eager migration is
required.

Custom databases implement the exported `Database` persistence contract. Use
`defineDatabase((bindings, context) => database)` when the implementation must
resolve a request-time host binding or storage partition.

## Endpoints

All routes require `Authorization: Bearer <credential>`, except the callback —
that one is hit by the user's browser and is authenticated by its single-use
`state` value instead. `BROKER_API_KEY` is the root credential and can access
every resource. It can mint expiring credentials limited to one or more
hierarchical resource folders. Outside production,
`BROKER_API_KEY` defaults to `test` when unset.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/oauth/providers` | Configured providers, their capabilities, and each `callback_url` to register (`?include_unconfigured=true` includes unavailable providers) |
| `POST` | `/api/admin/tokens` | Mint a named, expiring broker credential for one or more resource scopes |
| `GET` | `/api/admin/tokens` | List active broker credentials by name only (root access required) |
| `DELETE` | `/api/admin/tokens/{name}` | Immediately revoke a named broker credential (root access required) |
| `GET` | `/api/secrets` | List accessible secret metadata (`?path_prefix=` optional; never returns values) |
| `PUT` | `/api/secrets/{path}` | Encrypt and store an arbitrary secret |
| `GET` | `/api/secrets/{path}` | Retrieve a decrypted secret (server-only) |
| `DELETE` | `/api/secrets/{path}` | Delete an arbitrary secret |
| `GET` | `/api/admin/providers` | List fixed templates and accessible dynamic provider configurations when management is enabled |
| `PUT` | `/api/admin/providers/{provider_path}` | Create or replace an accessible dynamic provider |
| `PATCH` | `/api/admin/providers/{provider_path}` | Update, disable, or re-enable an accessible dynamic provider |
| `DELETE` | `/api/admin/providers/{provider_path}` | Delete an accessible, unused dynamic provider |
| `POST` | `/api/oauth/authorize/{provider_path}` | Mint a consent URL (optional `connection_id` or `connection_id_prefix`) |
| `GET` | `/api/oauth/callback/{provider_path}` | Provider redirect target |
| `GET` | `/api/oauth/client-metadata/{provider_path}` | Public OAuth client metadata for compatible MCP authorization servers |
| `GET` | `/api/oauth/connections` | List connections (`?provider=` and `?connection_id_prefix=` optional) |
| `GET` | `/api/oauth/connections/{connection_id}` | Get one connection (never tokens) |
| `GET` | `/api/oauth/tokens/{connection_id}` | A token valid *right now* |
| `DELETE` | `/api/oauth/connections/{connection_id}` | Revoke upstream when supported, then forget a connection |

Set `organizationRouting: true` to move OAuth management endpoints below
`/api/organization/{organization}/oauth`. For example, Acme lists connections
at `/api/organization/acme/oauth/connections`, and an authorization without an
explicit id is minted below `acme/`. Explicit ids and prefixes must also belong
to `acme`.
Stats and broker-token admin routes remain deployment-wide. Secret and dynamic
provider routes are also available below `/api/organization/{organization}`.
Provider callbacks deliberately remain global at
`/api/oauth/callback/{provider_path}`. Organization-scoped flows
carry an authenticated, encrypted storage-partition key in OAuth `state`; the
corresponding hashed database record keeps callback completion single-use.
Postgres persists the organization separately on both authorization state and
connection rows; the connection-id prefix remains a defense-in-depth namespace
boundary rather than the sole tenant identifier.

Connection and provider paths share one opaque slash-delimited resource
namespace; they are not filesystem paths. A credential scoped to
`team/payments/**` can create, manage, and use provider configurations and
connections below that path, but cannot reach a root or sibling provider.
Fixed providers remain visible through the management API as templates; using
their root paths still requires root scope. Because MCP provider creation may
perform outbound discovery or client registration, only issue scoped
credentials to principals trusted to configure providers within their subtree.
Paths are limited to 512 characters and must use NFC Unicode with non-empty
segments. Hookfish rejects dot segments, backslashes, control and bidirectional
formatting characters, and encoded values that decode into path structure.

Swagger UI always lives at `/api`, with its document at `/api/openapi.json`.
With `includeSwagger: true`, the document includes the complete server API.
With `includeSwagger: false`, it includes only client-safe routes and advertises
`/api/client` as its server.

## Usage

Start a connection. Omit `connection_id` to have the broker mint one as
`word-word-number` (e.g. `swift-orchid-4821`):

```sh
curl -X POST http://127.0.0.1:5173/api/oauth/authorize/notion \
  -H "Authorization: Bearer $BROKER_API_KEY" \
  -H 'content-type: application/json' \
  -d '{}'
```

```json
{
  "connection_id": "swift-orchid-4821",
  "authorize_url": "https://api.notion.com/v1/oauth/authorize?...",
  "expires_at": "2026-07-29T04:26:02.024Z"
}
```

To mint the generated id inside a path, pass `connection_id_prefix` instead:

```json
{
  "connection_id_prefix": "team/payments"
}
```

The resulting id will look like `team/payments/swift-orchid-4821`.

Pass your own id to reconnect the same link:

Connection ids may contain `/` and span multiple path segments, such as
`a/b-c/d`. Use the same complete id in the connection and token URLs.

```sh
curl -X POST http://127.0.0.1:5173/api/oauth/authorize/notion \
  -H "Authorization: Bearer $BROKER_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"connection_id":"team/swift-orchid-4821"}'
```

Redirect the user to `authorize_url`; OAuth state is already embedded in that
URL and is intentionally not returned separately. When the user approves, the
broker stores the tokens and sends them to the configured `returnTo` URL with
`hookfish_status=connected`, `provider`, and `connection_id` query parameters
(`connected=<provider>` is retained for compatibility). If `returnTo` is
omitted, the callback displays a default development completion page.

An authorization may instead pass an absolute `return_to` URL. Its origin must
appear in `trustedOrigins`; Hookfish persists the validated destination with
the authorization state and never trusts a return URL from the provider
callback. Provider denials redirect there with `hookfish_status=error` and a
stable `error` code.

```json
{
  "connection_id": "team/swift-orchid-4821",
  "return_to": "https://app.example.com/settings/integrations"
}
```

List what you have, or fetch one:

Connection prefixes respect `/` segment boundaries. For example, `team/apple`
matches `team/apple` and descendants such as `team/apple/calendar`, but not
`team/apples`. End the prefix with `/` to list descendants without matching the
prefix itself.

```sh
curl -H "Authorization: Bearer $BROKER_API_KEY" \
  "http://127.0.0.1:5173/api/oauth/connections?provider=notion&connection_id_prefix=team"

curl -H "Authorization: Bearer $BROKER_API_KEY" \
  "http://127.0.0.1:5173/api/oauth/connections/team/swift-orchid-4821"
```

Then, whenever you need to call the provider:

```sh
curl -H "Authorization: Bearer $BROKER_API_KEY" \
  "http://127.0.0.1:5173/api/oauth/tokens/team/swift-orchid-4821"
```

```json
{
  "connection_id": "team/swift-orchid-4821",
  "provider": "notion",
  "access_token": "secret_...",
  "token_type": "bearer",
  "scopes": [],
  "expires_at": null,
  "refreshed": false
}
```

`refreshed: true` means the stored token had expired and was renewed on this
call. If a connection expires with no usable refresh token, you get `401
reauthorization_required` — send the user through `authorize` again.

## Hierarchical broker access tokens

Connection scopes are absolute folder paths. Submit `team` and the API
canonicalizes it to `team/**`, granting the connection id `team` and every
descendant such as `team/notion` or `team/eu/github`; it does not include
`other/team/notion` or `teamish/notion`. Use `**` to grant root access.

Mint a named, one-hour credential for one or more scopes with the root key:

```sh
curl -X POST http://127.0.0.1:5173/api/admin/tokens \
  -H "Authorization: Bearer $BROKER_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"name":"team-worker","scopes":["team"],"expires_in":3600}'
```

```json
{
  "name": "team-worker",
  "access_token": "hookfish_at_v1.eyJ2IjoxLC...",
  "token_type": "Bearer",
  "scopes": ["team/**"],
  "expires_at": "2026-08-04T20:00:00.000Z"
}
```

Use that token in the same `Authorization` header. A token may contain up to 32
scopes. Listing connections returns only connections matched by at least one
of them. Getting a connection, retrieving its provider token, deleting it, or
starting an authorization outside every scope returns `403
insufficient_scope`. A non-root scoped credential must provide
`connection_id` or `connection_id_prefix` when starting authorization because
a root-level generated id would fall outside its namespace.

Scoped credentials can mint credentials at the same or a narrower folder (for
example, a token for `team` can mint one for `team/eu`) but cannot broaden
their scope or create a credential that outlives them. Delegated token names
must be nested below the issuer's name: `team-worker` can mint
`team-worker.eu`, but not `production-api`. Lifetimes default to one hour and
are capped at 30 days.

Root credentials can list active token names:

```sh
curl -H "Authorization: Bearer $BROKER_API_KEY" \
  http://127.0.0.1:5173/api/admin/tokens
```

```json
{ "tokens": ["team-worker", "production-api"] }
```

The listing deliberately returns names only—never bearer values, scopes, or
expiration metadata. Names are unique among active tokens and may be reused
after the previous token expires.

Revoke a token immediately with the root credential:

```sh
curl -X DELETE -H "Authorization: Bearer $BROKER_API_KEY" \
  http://127.0.0.1:5173/api/admin/tokens/team-worker
```

The broker stores only a SHA-256 hash of each token's random identifier. Every
scoped request must match an unexpired database record after its HMAC signature
is verified. The record's scopes and expiration are authoritative, so narrowing
either value takes effect on the next request; deleting the record invalidates
the bearer credential without rotating `BROKER_API_KEY`.

## Generic secret vault

Store non-OAuth credentials at the same hierarchical paths used by broker
access scopes:

```sh
curl -X PUT http://127.0.0.1:5173/api/secrets/team/browserbase/api-key \
  -H "Authorization: Bearer $BROKER_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"value":"secret"}'
```

Retrieve the value from trusted server code:

```sh
curl -H "Authorization: Bearer $BROKER_API_KEY" \
  http://127.0.0.1:5173/api/secrets/team/browserbase/api-key
```

`GET /api/secrets?path_prefix=team` lists paths and timestamps without values.
Secret values are AES-GCM encrypted with `OAUTH_ENCRYPTION_KEY`, excluded from
the browser-safe facade, and returned with `Cache-Control: no-store`. Scoped
broker credentials can access only secret paths covered by their existing
hierarchical scopes. Paths below `__hookfish/` are reserved for internal
provider credentials and cannot be reached through the public vault API.

## Dynamic providers

Fixed providers remain as ergonomic as before, and shipped packages also
export `create*Provider` helpers:

```ts
import { createGitHubProvider } from '@hookfish/provider-github'

type Bindings = {
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
}

export default defineHookfishConfig<Bindings>({
  db,
  providerManagement: true,
  providers: (env) => ({
    github: createGitHubProvider({
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    }),
  }),
})
```

The fixed `github` entry is directly usable and is also a trusted template for
database-backed instances. Create one that inherits the complete fixed
credential pair:

```sh
curl -X PUT http://127.0.0.1:5173/api/admin/providers/acme-github \
  -H "Authorization: Bearer $BROKER_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"template":"github","label":"Acme GitHub","credentials":{"mode":"inherit"}}'
```

Or provide a complete custom pair:

```json
{
  "template": "github",
  "credentials": {
    "mode": "custom",
    "client_id": "Iv1...",
    "client_secret": "write-only"
  }
}
```

Custom client secrets are stored in the internal vault and never returned.
Hookfish resolves database providers per request, so creates and updates take
effect across processes without restart. Fixed IDs are reserved. Setting
`enabled: false` blocks new authorizations but preserves callback completion,
refresh, and revocation for existing connections. Deletion returns `409` while
a connection still references the provider. `providerManagement` gates only
the CRUD API; pre-provisioned dynamic rows continue to resolve when it is off.
`inherit` uses the current request's template credentials from `env`; `custom`
atomically replaces that pair with the database client id and encrypted vault
secret.

### Remote MCP servers

Register the bundled MCP template to let provider management create OAuth
connections for arbitrary remote MCP endpoints:

```ts
import { createMcpProvider } from '@hookfish/provider-mcp'

export default defineHookfishConfig({
  db,
  providerManagement: true,
  providers: {
    mcp: createMcpProvider(),
  },
})
```

Then create a configured instance with the MCP resource URL. Hookfish follows
the MCP protected-resource and authorization-server metadata discovery flow,
requires PKCE S256, and includes the RFC 8707 `resource` parameter in
authorization and token requests:

```sh
curl -X PUT http://127.0.0.1:5173/api/admin/providers/acme-mcp \
  -H "Authorization: Bearer $BROKER_API_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "template":"mcp",
    "label":"Acme MCP",
    "configuration":{
      "resource_url":"https://mcp.acme.example/mcp",
      "scopes":["tools:read"]
    },
    "credentials":{"mode":"register"}
  }'
```

Automatic registration prefers an OAuth Client ID Metadata Document and falls
back to Dynamic Client Registration when the authorization server supports it.
For a pre-registered client, use `{"mode":"custom","client_id":"..."}`;
`client_secret` is optional for public MCP clients and encrypted when supplied.
The frontend exposes the same options through **Add provider**.

## Adding a provider

Provider slugs belong to the application, not to provider classes. Add the
providers you want in the root `hookfish.config.ts`:

```sh
pnpm add @hookfish/api @hookfish/database @hookfish/provider \
  @hookfish/provider-github @hookfish/provider-notion @acme/provider-slack
pnpm add --save-dev hookfish
```

```ts
import { defineHookfishConfig } from '@hookfish/api'
import { createGitHubProvider } from '@hookfish/provider-github'
import { createNotionProvider } from '@hookfish/provider-notion'
import { SlackProvider } from '@acme/provider-slack'

type Bindings = {
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  SLACK_CLIENT_ID?: string
  SLACK_CLIENT_SECRET?: string
}

export default defineHookfishConfig<Bindings>({
  includeClient: true,
  includeSwagger: true,
  providers: (env) => ({
    github: createGitHubProvider({
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    }),
    notion: createNotionProvider(),
    slack: new SlackProvider({
      clientId: env.SLACK_CLIENT_ID,
      clientSecret: env.SLACK_CLIENT_SECRET,
    }),
  }),
})
```

After `const hookfish = await Hookfish.init(config)`, the instance's
`fetch` property is already bound, so hosts can pass it directly or call
`hookfish.fetch(request, bindings)`.

The built-ins also read their conventional `<PROVIDER>_CLIENT_ID` and
`<PROVIDER>_CLIENT_SECRET` variables when constructor values are omitted. A
later registration for the same slug replaces the earlier one, so an app can
override a built-in without editing broker code.

To publish a custom provider, create an ordinary package that depends only on
`@hookfish/provider` plus the provider's official SDK. The contract has two
required lifecycle methods plus optional refresh and revocation methods;
protocol details stay inside the class:

```ts
import type {
  CreateAuthorizationInput,
  ExchangeCodeInput,
  OAuthProvider,
  ProviderTokenResponse,
  RefreshTokenInput,
  RevokeTokenInput,
} from '@hookfish/provider'

export class SlackProvider implements OAuthProvider {
  readonly label = 'Slack'
  readonly defaultScopes = ['channels:read']
  readonly availableScopes = ['channels:read', 'channels:write']

  constructor(
    private readonly options: {
      clientId?: string
      clientSecret?: string
    } = {},
  ) {}

  createAuthorization(input: CreateAuthorizationInput) {
    // Use the Slack SDK to return { url, codeVerifier? }.
    throw new Error('Implement with the Slack SDK')
  }
  async exchangeCode(
    input: ExchangeCodeInput,
  ): Promise<ProviderTokenResponse> {
    // Use the Slack SDK to return { payload, account? }.
    throw new Error('Implement with the Slack SDK')
  }
  async refreshToken(
    input: RefreshTokenInput,
  ): Promise<ProviderTokenResponse> {
    // Optional. Omit when Slack cannot refresh this token type.
    throw new Error('Implement with the Slack SDK')
  }
  async revokeToken(input: RevokeTokenInput): Promise<void> {
    // Optional. Revoke upstream access (and refresh tokens when applicable).
    throw new Error('Implement with the Slack SDK')
  }
}
```

The broker never imports this package. The host entrypoint does, so custom
providers can be installed, registered, and upgraded independently without
forking the broker repository.

A plain `OAuthProvider` remains valid as a fixed provider. To let dynamic
provider rows reuse it as a template, implement `OAuthProviderTemplate` by
adding `createProvider(credentials?)`; the method should return a fresh
provider using its fixed defaults when credentials are omitted and replace the
complete client credential pair when they are supplied.

The `scopes` field on each authorize request selects permissions for that flow;
when omitted, the provider's `defaultScopes` apply. `GET /providers` exposes
both the defaults as `scopes` and the provider's selection catalog as
`available_scopes`. It also reports `supports_refresh` and
`supports_revocation`, so clients do not need provider-specific knowledge.

The broker only coordinates state and persistence. URL parameters, scope
formatting, request encoding, client authentication, PKCE, and response account
metadata belong to the provider implementation.

Each shipped provider has a focused `test/provider.test.ts` because its SDK and
OAuth dialect are independent. Custom packages do not need that exact filename,
but should test URL construction, token parsing, error mapping, and refresh when
supported. Run everything with `pnpm test`, or one package with:

```sh
pnpm --filter @hookfish/provider-github test
```

## Security notes

- Access and refresh tokens are encrypted with AES-GCM (`OAUTH_ENCRYPTION_KEY`)
  before being written. **Rotating that key makes existing tokens
  unreadable.** The plaintext is never stored or logged.
- `metadata` retains the provider's token payload minus `access_token`,
  `refresh_token`, and `id_token`.
- OAuth `state` values are stored only as SHA-256 hashes and expire after 10
  minutes. Callback rows move through `pending`, `processing`, and a terminal
  status; replaying a completed callback returns the same connection without
  exchanging the provider code again.
- The API key is compared without early exit to keep it off the timing side
  channel.
- Scoped broker credentials are named and HMAC-signed with `BROKER_API_KEY`.
  Bearer values and raw token identifiers are never stored. A SHA-256 identifier
  hash links each signed token to an authoritative database record for immediate
  scope narrowing, expiry changes, and individual revocation. Rotating
  `BROKER_API_KEY` still invalidates every scoped token at once.
- Connection-listing responses never include token columns.
- Token responses send `Cache-Control: no-store` and `Pragma: no-cache`.
- Disconnect revokes access upstream for GitHub, Linear, and Notion before
  deleting locally. A provider failure returns `token_revocation_failed` and
  retains the encrypted record for retry; providers without a revocation
  implementation are deleted locally and report `revocation: "unsupported"`.
