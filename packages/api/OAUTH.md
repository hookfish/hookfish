# OAuth broker

Brokers OAuth connections keyed by a **connection group** and a **provider id**
(`notion`, `linear`, `google`, or any id you register). A connection group is
the opaque bucket that owns connections — today you typically use one group per
end-user of your app. The broker runs the consent flow, stores the tokens
encrypted, and hands back a valid access token on demand — refreshing
transparently when one is about to expire.

Providers are **database rows**, configured entirely over the API. Adding a new
IdP never requires a code change, env var, or redeploy.

## Setup

```sh
cp apps/server/.env.example apps/server/.env

# Fill in at minimum:
openssl rand -base64 32   # -> OAUTH_ENCRYPTION_KEY
openssl rand -base64 32   # -> BROKER_API_KEY
# ...plus NOTION_CLIENT_ID / NOTION_CLIENT_SECRET
```

Register the callback URL in each provider's developer console. The broker
always derives it as `{BASE_URL}/api/oauth/{provider}/callback` — see
[Callback URLs](#callback-urls) for where `BASE_URL` comes from:

```sh
pnpm portless:url   # e.g. https://my-branch.frontend.localhost
```

```sh
pnpm --filter @template/server dev
pnpm db:seed   # registers Notion from .env via the API
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
| `GET` | `/api/oauth/providers` | List registered providers (no secrets) |
| `POST` | `/api/oauth/providers` | Register a provider (dialect + credentials) |
| `GET` | `/api/oauth/providers/{id}` | Get one provider |
| `PATCH` | `/api/oauth/providers/{id}` | Update a provider (partial) |
| `DELETE` | `/api/oauth/providers/{id}` | Delete a provider (+ its connections) |
| `POST` | `/api/oauth/{provider}/authorize` | Mint a consent URL for a connection group |
| `GET` | `/api/oauth/{provider}/callback` | Provider redirect target |
| `GET` | `/api/oauth/connections?connection_group_id=` | A group's connections (never tokens) |
| `GET` | `/api/oauth/connections/{provider}/token?connection_group_id=` | A token valid *right now* |
| `DELETE` | `/api/oauth/connections/{provider}?connection_group_id=` | Forget a connection |

Swagger UI lives at `/api`.

## Register a provider

```sh
curl -X POST http://localhost:8787/api/oauth/providers \
  -H "Authorization: Bearer $BROKER_API_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "id": "notion",
    "label": "Notion",
    "authorize_url": "https://api.notion.com/v1/oauth/authorize",
    "token_url": "https://api.notion.com/v1/oauth/token",
    "client_id": "'"$NOTION_CLIENT_ID"'",
    "client_secret": "'"$NOTION_CLIENT_SECRET"'",
    "default_scopes": [],
    "token_request_format": "json",
    "client_auth": "basic",
    "use_pkce": false,
    "supports_refresh": false,
    "authorize_params": { "owner": "user" },
    "account_id_path": "workspace_id",
    "account_label_path": "workspace_name"
  }'
```

Linear and Google look the same — only the dialect fields change:

```sh
# Linear
curl -X POST http://localhost:8787/api/oauth/providers \
  -H "Authorization: Bearer $BROKER_API_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "id": "linear",
    "label": "Linear",
    "authorize_url": "https://linear.app/oauth/authorize",
    "token_url": "https://api.linear.app/oauth/token",
    "client_id": "'"$LINEAR_CLIENT_ID"'",
    "client_secret": "'"$LINEAR_CLIENT_SECRET"'",
    "default_scopes": ["read", "write"],
    "scope_separator": ",",
    "token_request_format": "form",
    "client_auth": "body",
    "supports_refresh": true
  }'

# Google
curl -X POST http://localhost:8787/api/oauth/providers \
  -H "Authorization: Bearer $BROKER_API_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "id": "google",
    "label": "Google",
    "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
    "token_url": "https://oauth2.googleapis.com/token",
    "client_id": "'"$GOOGLE_CLIENT_ID"'",
    "client_secret": "'"$GOOGLE_CLIENT_SECRET"'",
    "default_scopes": ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.readonly"],
    "use_pkce": true,
    "supports_refresh": true,
    "authorize_params": { "access_type": "offline", "prompt": "consent" }
  }'
```

Client id/secret are encrypted with `OAUTH_ENCRYPTION_KEY` before write and
never returned by list/get.

To register Notion from env vars without typing the dialect by hand:

```sh
pnpm db:seed
```

That boots the same local PGlite as the server, then calls
`POST /api/oauth/providers` (or `PATCH` if the id already exists) through the
Hono RPC client. Notion is skipped unless both `NOTION_CLIENT_ID` and
`NOTION_CLIENT_SECRET` are in `apps/server/.env`; `NOTION_SCOPES` overrides
`default_scopes` when set.

PGlite is embedded rather than a server, so a dev server that is already
running holds its own copy of `pgdata` in memory and will not see the seeded
rows. Restart it afterwards, or seed before starting it.

### Advertising scopes

`available_scopes` is the catalog of every scope a provider can grant, returned
by list/get so a caller can render a scope picker:

```jsonc
"available_scopes": [
  { "value": "workspace:read", "description": "View workspaces" },
  { "value": "workspace:export", "description": "Export workspaces" }
]
```

It is advertisement only. What actually goes on the authorize URL is
`default_scopes`, or the `scopes` field on the authorize request when that
overrides it — the broker does not currently check requested scopes against
this catalog.

## Callback URLs

The broker derives every callback as
`{BASE_URL}/api/oauth/{provider}/callback`. Callers cannot supply one: whoever
chooses the redirect URI chooses where the authorization code is delivered, so
that has to stay server-side.

`BASE_URL` is a Cloudflare `vars` binding read off `c.env`, declared in both
`wrangler.jsonc` files. Resolution order:

| Where | Value |
| --- | --- |
| `pnpm dev` / `pnpm --filter @template/server dev` | your branch's portless origin, injected by `scripts/portless-dev.mjs` |
| `apps/server/.env` or the shell | whatever you set — this wins over the portless default |
| Deployed Worker | the `BASE_URL` var, or the request origin when it is empty |

So on branch `my-branch` the URL to register with Notion is:

```
https://my-branch.frontend.localhost/api/oauth/notion/callback
```

Run `pnpm portless:url` to print the origin. Because portless derives it from
the branch name, **the callback changes when you switch branches** — either
register each branch's URL or pin `BASE_URL` in `apps/server/.env`.

## Usage

Start a connection:

```sh
curl -X POST http://localhost:8787/api/oauth/notion/authorize \
  -H "Authorization: Bearer $BROKER_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"connection_group_id":"group_123","return_to":"http://localhost:3000/settings"}'
```

```json
{
  "authorize_url": "https://api.notion.com/v1/oauth/authorize?...",
  "state": "Dj9kx_AlpE0...",
  "expires_at": "2026-07-29T04:26:02.024Z"
}
```

Redirect the end-user to `authorize_url`. When they approve, the broker stores
the connection under the group and sends them to `return_to?connected=notion`.

Then, whenever you need to call the provider:

```sh
curl -H "Authorization: Bearer $BROKER_API_KEY" \
  "http://localhost:8787/api/oauth/connections/notion/token?connection_group_id=group_123"
```

```json
{
  "provider": "notion",
  "connection_group_id": "group_123",
  "access_token": "secret_...",
  "token_type": "bearer",
  "scopes": [],
  "expires_at": null,
  "refreshed": false
}
```

`refreshed: true` means the stored token had expired and was renewed on this
call. If a connection expires with no usable refresh token, you get `401
reauthorization_required` — send them through `authorize` again.

## Dialect fields

| Field | Meaning |
|---|---|
| `scope_separator` | Join character for scopes (` ` or `,`) |
| `token_request_format` | `form` or `json` body on the token endpoint |
| `client_auth` | `basic` header vs `body` fields for client credentials |
| `use_pkce` | S256 code challenge on authorize |
| `supports_refresh` | Whether refresh_token grants are expected to work |
| `authorize_params` | Extra query params on the authorize URL |
| `account_id_path` / `account_label_path` | Dot-paths into the token JSON for account identity |

The `scopes` field on the authorize request overrides `default_scopes` per flow.

## Security notes

- Access/refresh tokens **and** provider client secrets are encrypted with
  AES-GCM (`OAUTH_ENCRYPTION_KEY`) before being written. **Rotating that key
  makes existing secrets unreadable.** The plaintext is never stored or logged.
- List/get provider responses never include credentials.
- `metadata` retains the provider's token payload minus `access_token`,
  `refresh_token`, and `id_token`.
- `state` rows are single-use and expire after 10 minutes; the callback deletes
  the row as it consumes it, so a replayed code is rejected.
- The API key is compared without early exit to keep it off the timing side
  channel.
- Connection-listing responses never include token columns.
- Deleting a provider also deletes its connections and in-flight states.
