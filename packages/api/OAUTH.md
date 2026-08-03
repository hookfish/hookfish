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
cp apps/server/.env.example apps/server/.env

# Fill in at minimum:
openssl rand -base64 32   # -> OAUTH_ENCRYPTION_KEY
openssl rand -base64 32   # -> BROKER_API_KEY
# ...plus NOTION_CLIENT_ID / NOTION_CLIENT_SECRET
```

```sh
pnpm exec template serve index.ts
```

The CLI loads the TypeScript file directly, then runs the Hono app on Node with
PGlite persisting to `pgdata` — no database to provision. It applies embedded
PGlite migrations automatically. `pnpm dev:server` loads the same `index.ts`
behind the portless proxy; pass another path to either command when needed.
Use `pnpm --filter @template/server dev:node` to run the monorepo's Node entry
without the proxy.
`pnpm dev` mounts the same Hono app directly in the TanStack Start Node server
(still with PGlite on disk), so you do not need a separate API process locally.

Then register the redirect URI in each provider's developer console. Ask the
running broker for the exact string rather than guessing it — the host depends
on your branch (portless prefixes non-`main` hosts) and on whether you reach
the API directly or through the frontend, and providers match `redirect_uri`
byte for byte:

```sh
curl -H "Authorization: Bearer $BROKER_API_KEY" \
  https://server.localhost/api/oauth/providers \
  | jq -r '.providers[] | "\(.id)\t\(.callback_url)"'
```

## Node entrypoints

Both entrypoints run the same Hono app (`@template/api`), Drizzle schema, and
migrations on Node:

| command | process | default database |
|---|---|---|
| `pnpm dev` | TanStack Start SSR + Hono API | `apps/frontend/pgdata` |
| `pnpm exec template serve index.ts` | standalone Hono API | `pgdata` |

Set `PGLITE_DATA_DIR` to move the embedded database. Set `DATABASE_URL` to use
Postgres instead.

### Configuring the database

`withDatabase` resolves in this order (first match wins):

1. **`env.DB`** — inject a ready Drizzle instance. Local Node does this for you
   (PGlite, or a pooled postgres.js client when `DATABASE_URL` is set).
2. **`env.DATABASE_URL`** — a Postgres URL. The Node entrypoint normally turns
   this into a pooled client and injects it as `env.DB`.

```sh
# Stock Node against real Postgres
DATABASE_URL=postgres://user:pass@127.0.0.1:5432/postgres \
  pnpm --filter @template/server dev:node
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
curl -X POST https://server.localhost/api/oauth/notion/authorize \
  -H "Authorization: Bearer $BROKER_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"return_to":"https://frontend.localhost/settings"}'
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
curl -X POST https://server.localhost/api/oauth/notion/authorize \
  -H "Authorization: Bearer $BROKER_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"connection_id":"swift-orchid-4821","return_to":"https://frontend.localhost/settings"}'
```

Redirect the user to `authorize_url`. When they approve, the broker stores the
tokens and sends them to `return_to?connected=notion`.

List what you have, or fetch one:

```sh
curl -H "Authorization: Bearer $BROKER_API_KEY" \
  "https://server.localhost/api/oauth/connections?provider=notion"

curl -H "Authorization: Bearer $BROKER_API_KEY" \
  "https://server.localhost/api/oauth/connections/swift-orchid-4821"
```

Then, whenever you need to call the provider:

```sh
curl -H "Authorization: Bearer $BROKER_API_KEY" \
  "https://server.localhost/api/oauth/connections/swift-orchid-4821/token"
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

Provider slugs belong to the application, not to provider classes. Put the
providers you want in an `index.ts` and pass it to the CLI (the filename
defaults to `index.ts`):

```sh
pnpm add @template/provider @template/provider-github \
  @template/provider-notion @acme/provider-slack
pnpm add --save-dev @template/cli
```

```ts
import { registerProvider } from '@template/provider'
import { GitHubProvider } from '@template/provider-github'
import { NotionProvider } from '@template/provider-notion'
import { SlackProvider } from '@acme/provider-slack'

export const providers = registerProvider({
  github: new GitHubProvider({
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  }),
  notion: new NotionProvider(),
  slack: new SlackProvider({
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
  }),
})
```

Exporting the returned registry lets the frontend or another Node host construct
an isolated API instance with `createApi({ providers })`. The CLI also supports
the short form without an export; it reads the registry populated by
`registerProvider`.

```sh
pnpm exec template serve index.ts
```

The built-ins also read their conventional `<PROVIDER>_CLIENT_ID` and
`<PROVIDER>_CLIENT_SECRET` variables when constructor values are omitted. A
later registration for the same slug replaces the earlier one, so an app can
override a built-in without editing broker code.

To publish a custom provider, create an ordinary package that depends only on
`@template/provider` plus the provider's official SDK. The contract has two
required lifecycle methods and one optional refresh method; protocol details
stay inside the class:

```ts
import type {
  CreateAuthorizationInput,
  ExchangeCodeInput,
  OAuthProvider,
  ProviderTokenResponse,
  RefreshTokenInput,
} from '@template/provider'

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

The broker never imports this package. The user's `index.ts` does, so custom
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
pnpm --filter @template/provider-github test
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
