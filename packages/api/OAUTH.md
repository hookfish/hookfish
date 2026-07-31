# OAuth broker

Brokers OAuth connections you manage under a **connection id**. You give it a
connection id (or let it mint one) and a **connection source** (`notion`,
`linear`, `google`, ...); it runs the consent flow, stores the tokens encrypted,
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
# Then configure provider credentials (see Adding a provider below)
```

```sh
pnpm --filter @template/server dev
```

That runs the Hono app on Node with PGlite persisting to `apps/server/pgdata` —
no database to provision. Run `pnpm migrate` first so the schema is applied.
Use `pnpm --filter @template/server dev:node` without the portless proxy.
`pnpm dev` does the same for frontend `/api` via a Vite Node middleware (still
PGlite on disk), so you do not need a separate API process locally.

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

## Why there are two entrypoints

PGlite's persistent backends are Node FS, IndexedDB, and OPFS — **none of which
exist in workerd**. The official `pglite-cloudflare-worker-example` runs it
purely in memory, which loses every token when the isolate recycles. So:

| | runtime | database |
|---|---|---|
| `pnpm dev` / `pnpm --filter @template/server dev` (no `DATABASE_URL`) | Node + PGlite | `apps/server/pgdata` |
| same commands **with** `DATABASE_URL` | Node + postgres.js | your Postgres |
| frontend Worker SSR, `dev:worker`, `deploy` | Workers | Hyperdrive binding **or** `DATABASE_URL` |

Same Hono app (`@template/api`), same Drizzle schema, same migrations.
`src/db/pglite.ts` / `local-node` are imported only from Node entrypoints, so
PGlite never enters the Worker bundle.

### Configuring the database

`withDatabase` resolves in this order (first match wins):

1. **`env.DB`** — inject a ready Drizzle instance. Local Node does this for you
   (PGlite, or a pooled postgres.js client when `DATABASE_URL` is set).
2. **`env.HYPERDRIVE`** — Cloudflare Hyperdrive binding. Uncomment the
   `hyperdrive` block in `apps/server/wrangler.jsonc` /
   `apps/frontend/wrangler.jsonc`, set the config id from
   `wrangler hyperdrive create`, and optionally `localConnectionString` for
   `wrangler dev`.
3. **`env.DATABASE_URL`** — stock Postgres URL. On Workers:
   `pnpm wrangler secret put DATABASE_URL`. On Node, set it in `.env` and the
   local entrypoint injects a pooled client as `env.DB` instead.

```sh
# Stock Node against real Postgres
DATABASE_URL=postgres://user:pass@127.0.0.1:5432/postgres \
  pnpm --filter @template/server dev:node
```

```sh
# Workers without Hyperdrive
pnpm wrangler secret put DATABASE_URL
```

## Endpoints

All routes require `Authorization: Bearer $BROKER_API_KEY`, except the callback
— that one is hit by the user's browser and is authenticated by its single-use
`state` value instead. Outside production, `BROKER_API_KEY` defaults to `test`
when unset.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/oauth/providers` | Which providers exist, which have credentials, and each `callback_url` to register |
| `GET` | `/api/oauth/providers/{provider}` | One provider's non-secret config |
| `POST` | `/api/oauth/providers` | Create a provider (encrypts `client_id` / `client_secret` when sent) |
| `PATCH` | `/api/oauth/providers/{provider}` | Update dialect and/or credentials |
| `DELETE` | `/api/oauth/providers/{provider}` | Delete a provider (409 if connections still reference it) |
| `POST` | `/api/oauth/provider/{provider}/authorize` | Mint a consent URL (optional `connection_id`) |
| `GET` | `/api/oauth/provider/{provider}/callback` | Provider redirect target |
| `GET` | `/api/oauth/connections` | List connections (`?provider=` optional) |
| `GET` | `/api/oauth/connections/{connection_id}` | Get one connection (never tokens) |
| `GET` | `/api/oauth/connections/{connection_id}/token` | A token valid *right now* |
| `DELETE` | `/api/oauth/connections/{connection_id}` | Forget a connection |

Swagger UI lives at `/api`.

## Usage

Start a connection. Omit `connection_id` to have the broker mint one as
`word-word-number` (e.g. `swift-orchid-4821`):

```sh
curl -X POST https://server.localhost/api/oauth/provider/notion/authorize \
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
curl -X POST https://server.localhost/api/oauth/provider/notion/authorize \
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

Providers live in the `oauth_providers` table. Notion, Linear, and Google are
seeded by migration (metadata only). Set credentials with PATCH:

```sh
curl -X PATCH https://server.localhost/api/oauth/providers/notion \
  -H "Authorization: Bearer $BROKER_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"client_id":"...","client_secret":"..."}'
```

Or create a wholly new provider:

```sh
curl -X POST https://server.localhost/api/oauth/providers \
  -H "Authorization: Bearer $BROKER_API_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "id": "slack",
    "label": "Slack",
    "authorize_url": "https://slack.com/oauth/v2/authorize",
    "token_url": "https://slack.com/api/oauth.v2.access",
    "default_scopes": ["channels:read"],
    "scope_separator": ",",
    "token_request_format": "form",
    "client_auth": "body",
    "use_pkce": false,
    "supports_refresh": true,
    "client_id": "...",
    "client_secret": "..."
  }'
```

Optional `account_id_field` / `account_label_field` name top-level keys on the
token response used to populate `external_account_id` / `external_account_label`
(e.g. Notion uses `workspace_id` / `workspace_name`).

The `scopes` field on the authorize request overrides `default_scopes` per flow.

The three shipped providers differ in exactly the ways the table models:
Notion uses HTTP Basic auth with a JSON body and issues non-expiring tokens with
no scope parameter; Linear separates scopes with commas; Google needs PKCE plus
`access_type=offline&prompt=consent` to return a refresh token at all.

During cutover, if a seeded row still has no secrets and matching
`<ID>_CLIENT_ID` / `_SECRET` env vars exist, `createLocalBrokerEnv` (Node server
and Vite local `/api`) copies them into the database once on startup. The OAuth
resolve path never reads those env vars.

## Security notes

- Access/refresh tokens **and** provider client secrets are encrypted with
  AES-GCM (`OAUTH_ENCRYPTION_KEY`) before being written. **Rotating that key
  makes existing secrets unreadable.** The plaintext is never stored or logged.
- `metadata` retains the provider's token payload minus `access_token`,
  `refresh_token`, and `id_token`.
- `state` rows are single-use and expire after 10 minutes; the callback deletes
  the row as it consumes it, so a replayed code is rejected.
- The API key is compared without early exit to keep it off the timing side
  channel.
- Connection-listing and provider-listing responses never include secret columns.
