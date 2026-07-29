# OAuth broker

Brokers OAuth connections on behalf of your users. You give it a **user id** and
a **connection source** (`notion`, `linear`, `google`, ...); it runs the consent
flow, stores the tokens encrypted, and hands back a valid access token on
demand — refreshing transparently when one is about to expire.

## Setup

```sh
cp apps/server/.env.example apps/server/.env

# Fill in at minimum:
openssl rand -base64 32   # -> OAUTH_ENCRYPTION_KEY
openssl rand -base64 32   # -> BROKER_API_KEY
# ...plus NOTION_CLIENT_ID / NOTION_CLIENT_SECRET
```

Register `http://localhost:8787/api/oauth/<provider>/callback` as the redirect
URI in each provider's developer console.

```sh
pnpm --filter @template/server dev
```

That runs the Hono app on Node with PGlite persisting to `apps/server/pgdata`,
applying migrations at startup — no database to provision. Use
`pnpm --filter @template/server dev:node` without the portless proxy.
`pnpm dev` does the same for frontend `/api` via a Vite Node middleware (still
PGlite on disk), so you do not need a separate API process locally.

## Why there are two entrypoints

PGlite's persistent backends are Node FS, IndexedDB, and OPFS — **none of which
exist in workerd**. The official `pglite-cloudflare-worker-example` runs it
purely in memory, which loses every token when the isolate recycles. So:

| | runtime | database |
|---|---|---|
| `pnpm dev` (frontend `/api`) / `pnpm --filter @template/server dev` / `dev:node` | Node + PGlite | `apps/server/pgdata` |
| frontend Worker SSR, `dev:worker`, `deploy` | Workers | Postgres over HTTP via `DATABASE_URL` |

Local API-only and frontend-mounted `/api` therefore need no `DATABASE_URL`.
Set one when exercising the Workers path (or production), which is worth doing
before deploying since that is the runtime production uses.

Same Hono app (`@template/api`), same Drizzle schema, same migrations.
`src/db/pglite.ts` / `local-node` are imported only from Node entrypoints, so
PGlite never enters the Worker bundle. For the Workers path, set `DATABASE_URL`
to a Neon-protocol Postgres and push secrets with `pnpm wrangler secret put <NAME>`.

## Endpoints

All routes require `Authorization: Bearer $BROKER_API_KEY`, except the callback
— that one is hit by the user's browser and is authenticated by its single-use
`state` value instead. Outside production, `BROKER_API_KEY` defaults to `test`
when unset.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/oauth/providers` | Which providers exist and which have credentials |
| `POST` | `/api/oauth/{provider}/authorize` | Mint a consent URL for a user |
| `GET` | `/api/oauth/{provider}/callback` | Provider redirect target |
| `GET` | `/api/oauth/connections?user_id=` | A user's connections (never tokens) |
| `GET` | `/api/oauth/connections/{provider}/token?user_id=` | A token valid *right now* |
| `DELETE` | `/api/oauth/connections/{provider}?user_id=` | Forget a connection |

Swagger UI lives at `/api`.

## Usage

Start a connection:

```sh
curl -X POST http://localhost:8787/api/oauth/notion/authorize \
  -H "Authorization: Bearer $BROKER_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"user_id":"user_123","return_to":"http://localhost:3000/settings"}'
```

```json
{
  "authorize_url": "https://api.notion.com/v1/oauth/authorize?...",
  "state": "Dj9kx_AlpE0...",
  "expires_at": "2026-07-29T04:26:02.024Z"
}
```

Redirect the user to `authorize_url`. When they approve, the broker stores the
connection and sends them to `return_to?connected=notion`.

Then, whenever you need to call the provider:

```sh
curl -H "Authorization: Bearer $BROKER_API_KEY" \
  "http://localhost:8787/api/oauth/connections/notion/token?user_id=user_123"
```

```json
{
  "provider": "notion",
  "user_id": "user_123",
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

Append an entry to `providerRegistry` in `src/oauth/providers.ts` and set
`<ID>_CLIENT_ID` / `<ID>_CLIENT_SECRET`. Nothing else changes. The registry
captures the per-provider dialect differences:

```ts
slack: {
  id: 'slack',
  label: 'Slack',
  authorizeUrl: 'https://slack.com/oauth/v2/authorize',
  tokenUrl: 'https://slack.com/api/oauth.v2.access',
  defaultScopes: ['channels:read'],
  scopeSeparator: ',',
  tokenRequestFormat: 'form',
  clientAuth: 'body',
  usePkce: false,
  supportsRefresh: true,
}
```

`<ID>_SCOPES` overrides `defaultScopes` per environment, and the `scopes` field
on the authorize request overrides it per flow.

The three shipped providers differ in exactly the ways the registry models:
Notion uses HTTP Basic auth with a JSON body and issues non-expiring tokens with
no scope parameter; Linear separates scopes with commas; Google needs PKCE plus
`access_type=offline&prompt=consent` to return a refresh token at all.

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
