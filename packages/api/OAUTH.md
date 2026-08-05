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
pnpm exec hookfish serve
```

The CLI runs the TanStack Start Node frontend, with Hookfish mounted directly at
`/api` and PGlite persisting to `pgdata`—no database or separate API process to
provision. The frontend, Node example, and local Worker all read
`apps/frontend/.env`; Wrangler receives it through its `--env-file` option.

Then register the redirect URI in each provider's developer console. Ask the
running broker for the exact string rather than guessing it—the host depends on
how you reach the API, and providers match `redirect_uri` byte for byte:

```sh
curl -H "Authorization: Bearer $BROKER_API_KEY" \
  http://127.0.0.1:5173/api/oauth/providers \
  | jq -r '.providers[] | "\(.id)\t\(.callback_url)"'
```

## Runtime entrypoints

Each host imports the `Hookfish` instance from the root `hookfish.config.ts`:

| command | process | default database |
|---|---|---|
| `pnpm exec hookfish serve` | TanStack Start Node SSR + Hookfish | `pgdata` |
| `pnpm --filter @hookfish/example-hono-node dev` | standalone Hono API | `pgdata` |
| `pnpm --filter @hookfish/example-cloudflare-worker dev` | Cloudflare Worker API | Switch config to Hyperdrive first |

Set `PGLITE_DATA_DIR` to move the embedded database. The root config contains
commented alternatives for Postgres and Cloudflare Hyperdrive.

### Configuring Hookfish

Database and provider configuration lives in the repository root so every host
uses the same setup. A database may be a ready Drizzle database, a promise, or
a request-aware database binding. The stock config currently uses PGlite:

```ts
// hookfish.config.ts
import { Hookfish } from '@hookfish/api'
import { pglite } from '@hookfish/database/pglite'
import { NotionProvider } from '@hookfish/provider-notion'

const db = pglite('./pgdata')

export default new Hookfish({
  db,
  // Disable the interactive docs while retaining /api/openapi.json:
  // swaggerUi: false,
  // Override the default development completion page before deploying:
  // returnTo: 'https://app.example.com/settings/integrations',
  providers: { notion: new NotionProvider() },
})
```

The checked-in config also includes commented `postgres()` examples for a
connection URL and for resolving a Cloudflare Hyperdrive binding.

Fetch entrypoints only import that instance and pass their runtime bindings:

```ts
import hookfish from '../../../hookfish.config'

export default {
  fetch: (request, env, ctx) => hookfish.fetch(request, env, ctx),
}
```

`pglite()` initializes lazily and applies the bundled migrations once.
`postgres()` accepts either a URL or a resolver called with the bindings passed
to `Hookfish.fetch(request, bindings)`.

The commented Hyperdrive config resolves `env.HYPERDRIVE.connectionString` from
the Wrangler-generated bindings. It disables client caching so each request
gets its own Postgres.js client while Hyperdrive maintains the underlying pool.
For another runtime, implement the same small binding contract with
`defineDatabase((bindings) => database)`.

`pnpm migrate` loads `hookfish.config.ts` and runs migrations through its `db`
binding. It fails explicitly when the file or database configuration is absent.

```sh
# After switching hookfish.config.ts to the Postgres example
DATABASE_URL=postgres://user:pass@127.0.0.1:5432/postgres \
  pnpm --filter @hookfish/example-hono-node dev
```

## Endpoints

All routes require `Authorization: Bearer <credential>`, except the callback —
that one is hit by the user's browser and is authenticated by its single-use
`state` value instead. `BROKER_API_KEY` is the root credential and can access
every connection. It can mint expiring credentials limited to one or more
hierarchical connection folders. Outside production,
`BROKER_API_KEY` defaults to `test` when unset.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/oauth/providers` | Which providers exist, which have credentials, their capabilities, and each `callback_url` to register |
| `POST` | `/api/admin/tokens` | Mint a named, expiring broker credential for one or more connection scopes |
| `GET` | `/api/admin/tokens` | List active broker credentials by name only (root access required) |
| `POST` | `/api/oauth/{provider}/authorize` | Mint a consent URL (optional `connection_id` or `connection_id_prefix`) |
| `GET` | `/api/oauth/{provider}/callback` | Provider redirect target |
| `GET` | `/api/oauth/connections` | List connections (`?provider=` and `?connection_id_prefix=` optional) |
| `GET` | `/api/oauth/connections/{connection_id}` | Get one connection (never tokens) |
| `GET` | `/api/oauth/tokens/{connection_id}` | A token valid *right now* |
| `DELETE` | `/api/oauth/connections/{connection_id}` | Revoke upstream when supported, then forget a connection |

Swagger UI lives at `/api` by default. Set `swaggerUi: false` in
`hookfish.config.ts` to disable the interactive page; `/api/openapi.json`
remains available for tooling.

## Usage

Start a connection. Omit `connection_id` to have the broker mint one as
`word-word-number` (e.g. `swift-orchid-4821`):

```sh
curl -X POST http://127.0.0.1:5173/api/oauth/notion/authorize \
  -H "Authorization: Bearer $BROKER_API_KEY" \
  -H 'content-type: application/json' \
  -d '{}'
```

```json
{
  "connection_id": "swift-orchid-4821",
  "authorize_url": "https://api.notion.com/v1/oauth/authorize?...",
  "state": "Dj9kx_AlpE0...",
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
curl -X POST http://127.0.0.1:5173/api/oauth/notion/authorize \
  -H "Authorization: Bearer $BROKER_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"connection_id":"team/swift-orchid-4821"}'
```

Redirect the user to `authorize_url`. When they approve, the broker stores the
tokens and sends them to the configured `returnTo` URL with
`?connected=notion` appended. If `returnTo` is omitted from the Hookfish
configuration, the callback displays a default development completion page
that reminds you to configure it before deploying.

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

## Adding a provider

Provider slugs belong to the application, not to provider classes. Add the
providers you want in the root `hookfish.config.ts`:

```sh
pnpm add @hookfish/api @hookfish/database @hookfish/provider \
  @hookfish/provider-github @hookfish/provider-notion @acme/provider-slack
pnpm add --save-dev @hookfish/cli
```

```ts
import { Hookfish } from '@hookfish/api'
import { postgres } from '@hookfish/database/postgres'
import { GitHubProvider } from '@hookfish/provider-github'
import { NotionProvider } from '@hookfish/provider-notion'
import { SlackProvider } from '@acme/provider-slack'

const hookfish = new Hookfish({
  db: postgres(process.env.DATABASE_URL!),
  providers: {
    github: new GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    }),
    notion: new NotionProvider(),
    slack: new SlackProvider({
      clientId: process.env.SLACK_CLIENT_ID,
      clientSecret: process.env.SLACK_CLIENT_SECRET,
    }),
  },
})
```

A Hookfish instance's `fetch` property is already bound, so hosts can pass it
directly or call `hookfish.fetch(request, bindings)`.

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

`<ID>_SCOPES` overrides `defaultScopes` per environment, and the `scopes` field
on the authorize request overrides it per flow. `GET /providers` exposes both
the defaults as `scopes` and the provider's selection catalog as
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
- `state` rows are single-use and expire after 10 minutes; the callback deletes
  the row as it consumes it, so a replayed code is rejected.
- The API key is compared without early exit to keep it off the timing side
  channel.
- Scoped broker credentials are named and HMAC-signed with `BROKER_API_KEY`.
  Their bearer values are stateless and never stored; only administrative
  metadata is retained for name listing. Rotating `BROKER_API_KEY` invalidates
  all of them. Individual revocation is not supported, so use short lifetimes
  for untrusted clients.
- Connection-listing responses never include token columns.
- Token responses send `Cache-Control: no-store` and `Pragma: no-cache`.
- Disconnect revokes access upstream for GitHub, Linear, and Notion before
  deleting locally. A provider failure returns `token_revocation_failed` and
  retains the encrypted record for retry; providers without a revocation
  implementation are deleted locally and report `revocation: "unsupported"`.
