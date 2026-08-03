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

Each host constructs a `Hookfish` instance next to its Fetch entrypoint:

| command | process | default database |
|---|---|---|
| `pnpm exec hookfish serve` | TanStack Start Node SSR + Hookfish | `pgdata` |
| `pnpm --filter @hookfish/example-hono-node dev` | standalone Hono API | `pgdata` |
| `pnpm --filter @hookfish/example-cloudflare-worker dev` | Cloudflare Worker API | Hyperdrive/Postgres |

On Node, set `PGLITE_DATA_DIR` to move the embedded database or `DATABASE_URL`
to use Postgres. Cloudflare entrypoints use Hyperdrive instead.

### Configuring the database

The application passes one database input to `new Hookfish({ db, providers })`.
It may be a ready Drizzle database, a promise, or a request-aware database
binding. The provided Node adapters are separate from the API core:

```ts
import { Hookfish } from '@hookfish/api'
import { pglite } from '@hookfish/database/pglite'
import { postgres } from '@hookfish/database/postgres'
import { NotionProvider } from '@hookfish/provider-notion'

const db = process.env.DATABASE_URL
  ? postgres(process.env.DATABASE_URL)
  : pglite('./pgdata')

export default new Hookfish({ db, providers: { notion: new NotionProvider() } })
```

`pglite()` initializes lazily and applies the bundled migrations once.
`postgres()` accepts either a URL or a resolver called with the bindings passed
to `Hookfish.fetch(request, bindings)`.

The Cloudflare API entrypoint passes the Wrangler-generated `Env` into a
request-aware `postgres()` binding and resolves
`env.HYPERDRIVE.connectionString`. It disables client caching so each request
gets its own Postgres.js client while Hyperdrive maintains the underlying pool.
For another runtime, implement the same small binding contract with
`defineDatabase((bindings) => database)`.

```sh
# Stock Node against real Postgres
DATABASE_URL=postgres://user:pass@127.0.0.1:5432/postgres \
  pnpm --filter @hookfish/example-hono-node dev
```

## Endpoints

All routes require `Authorization: Bearer $BROKER_API_KEY`, except the callback
— that one is hit by the user's browser and is authenticated by its single-use
`state` value instead. Outside production, `BROKER_API_KEY` defaults to `test`
when unset.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/oauth/providers` | Which providers exist, which have credentials, and each `callback_url` to register |
| `POST` | `/api/oauth/{provider}/authorize` | Mint a consent URL (optional `connection_id`) |
| `GET` | `/api/oauth/{provider}/callback` | Provider redirect target |
| `GET` | `/api/oauth/connections` | List connections (`?provider=` optional) |
| `GET` | `/api/oauth/connections/{connection_id}` | Get one connection (never tokens) |
| `GET` | `/api/oauth/connections/{connection_id}/token` | A token valid *right now* |
| `DELETE` | `/api/oauth/connections/{connection_id}` | Forget a connection |

Swagger UI lives at `/api`.

## Usage

Start a connection. Omit `connection_id` to have the broker mint one as
`word-word-number` (e.g. `swift-orchid-4821`):

```sh
curl -X POST http://127.0.0.1:5173/api/oauth/notion/authorize \
  -H "Authorization: Bearer $BROKER_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"return_to":"http://127.0.0.1:5173/settings"}'
```

```json
{
  "connection_id": "swift-orchid-4821",
  "authorize_url": "https://api.notion.com/v1/oauth/authorize?...",
  "state": "Dj9kx_AlpE0...",
  "expires_at": "2026-07-29T04:26:02.024Z"
}
```

Pass your own id to reconnect the same link:

```sh
curl -X POST http://127.0.0.1:5173/api/oauth/notion/authorize \
  -H "Authorization: Bearer $BROKER_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"connection_id":"swift-orchid-4821","return_to":"http://127.0.0.1:5173/settings"}'
```

Redirect the user to `authorize_url`. When they approve, the broker stores the
tokens and sends them to `return_to?connected=notion`.

List what you have, or fetch one:

```sh
curl -H "Authorization: Bearer $BROKER_API_KEY" \
  "http://127.0.0.1:5173/api/oauth/connections?provider=notion"

curl -H "Authorization: Bearer $BROKER_API_KEY" \
  "http://127.0.0.1:5173/api/oauth/connections/swift-orchid-4821"
```

Then, whenever you need to call the provider:

```sh
curl -H "Authorization: Bearer $BROKER_API_KEY" \
  "http://127.0.0.1:5173/api/oauth/connections/swift-orchid-4821/token"
```

```json
{
  "connection_id": "swift-orchid-4821",
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

## Adding a provider

Provider slugs belong to the application, not to provider classes. Add the
providers you want where the host constructs `Hookfish`—for example,
`examples/hono-node/src/index.ts` or `apps/frontend/src/server.ts`:

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
required lifecycle methods and one optional refresh method; protocol details
stay inside the class:

```ts
import type {
  CreateAuthorizationInput,
  ExchangeCodeInput,
  OAuthProvider,
  ProviderTokenResponse,
  RefreshTokenInput,
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
}
```

The broker never imports this package. The host entrypoint does, so custom
providers can be installed, registered, and upgraded independently without
forking the broker repository.

`<ID>_SCOPES` overrides `defaultScopes` per environment, and the `scopes` field
on the authorize request overrides it per flow. `GET /providers` exposes both
the defaults as `scopes` and the provider's selection catalog as
`available_scopes`.

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
- Connection-listing responses never include token columns.
