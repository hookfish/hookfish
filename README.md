# Hookfish

A portable OAuth and encrypted-secret broker with a static React dashboard and Fetch-compatible
backend runtimes:

- `apps/frontend` — Vite SPA with TanStack Router and React Query
- `apps/inspector` — TanStack Start inspector for remote MCP servers
- `packages/backend` — browser-safe facade plus raw Hookfish API composition
- `packages/api` — shared Hono API and OAuth broker
- `packages/hooks` — typed Hono RPC clients, query options, and React hooks
- `packages/database` — local PGlite and request-aware Postgres bindings
- `packages/provider` and `packages/providers/*` — provider contracts and implementations
- `examples/hono-node` — default Node backend using PGlite
- `examples/express` and `examples/nextjs` — alternative Node hosts
- `examples/cloudflare-worker` — Worker backend using Hyperdrive/Postgres

The frontend contains no server functions or database code. Every host exposes:

- `/api/*` — raw Hookfish API, documentation, and OAuth callbacks
- `/api/client/*` — allowlisted browser facade with server-side broker credentials

## Local development

```sh
pnpm install
cp apps/frontend/.env.example apps/frontend/.env
# Fill OAUTH_ENCRYPTION_KEY, BROKER_API_KEY, and provider credentials.

pnpm dev
# Equivalent: pnpm exec hookfish dev --backend hono-node
# Frontend: http://127.0.0.1:5173
# Backend:  http://127.0.0.1:8787

pnpm dev --no-open
pnpm dev --backend cloudflare-worker
```

Start the standalone inspector with `npx hookfish inspect`. The `inspector`
command is an alias. In this repository, `pnpm cli inspect` runs the same
packaged server. It mounts the raw API at `/api` and the browser client facade
at `/api/client`, backed by PGlite in `~/.hookfish/inspector` by default.
`HOOKFISH_API_KEY` defaults to `test` when unset or empty.

`hookfish dev` delegates to `turbo dev` filtered to the frontend and the selected
backend. Choose `hono-node` (the default), `express`, `nextjs`, or
`cloudflare-worker` with `--backend`. The Vite server proxies `/api` to that
backend. The default Hono backend stores PGlite data in
`pgdata` and applies embedded migrations lazily. Set `PGLITE_DATA_DIR` to move
it. In Conductor, the CLI automatically uses `CONDUCTOR_PORT` for the frontend
and the next allocated port for the backend. `hookfish serve` remains an alias.

## Pointing the SPA at another backend

Run any backend, then either make the Vite proxy target it:

```sh
HOOKFISH_BACKEND_URL=http://127.0.0.1:3000 \
  pnpm --filter @hookfish/frontend dev
```

Or call it directly from the browser:

```sh
VITE_BACKEND_URL=http://127.0.0.1:3000 \
  pnpm --filter @hookfish/frontend dev
```

Direct cross-origin calls require the frontend origin to match
`HOOKFISH_FRONTEND_URL` in the backend environment. The default is
`http://127.0.0.1:5173`. The proxy approach stays same-origin and is generally
more convenient for local backend matrix testing.

Available backends:

```sh
# PGlite on http://127.0.0.1:8787
pnpm --filter @hookfish/example-hono-node dev

# PGlite on http://127.0.0.1:3000
pnpm --filter @hookfish/example-express dev
pnpm --filter @hookfish/example-nextjs dev

# Hyperdrive/Postgres on http://127.0.0.1:8787
pnpm --filter @hookfish/example-cloudflare-worker dev
```

The root `hookfish.config.ts` owns the default PGlite database, providers,
browser policy, and documentation visibility. Node examples use it unchanged;
the Worker replaces only `db` with its Hyperdrive/Postgres binding. Provider
factories receive the bindings passed to `Hookfish.fetch`, so the same config
reads Node environment variables and Worker secrets without a config schema.

## Cloudflare Worker backend

Create a Hyperdrive configuration and replace `<YOUR_HYPERDRIVE_ID>` in
`examples/cloudflare-worker/wrangler.jsonc`:

```sh
pnpm --filter @hookfish/example-cloudflare-worker exec wrangler login
pnpm --filter @hookfish/example-cloudflare-worker exec wrangler hyperdrive create hookfish-db \
  --connection-string="postgres://user:pass@host:5432/dbname"
pnpm cf-typegen
pnpm cf-typecheck
```

For local Wrangler development, set `DATABASE_URL` in `apps/frontend/.env` to a
direct Postgres connection. `hookfish dev` maps it to Wrangler's local
Hyperdrive binding. Standalone Wrangler development can instead use its native
variable name:

```sh
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://user:pass@127.0.0.1:5432/dbname
```

Apply the Worker database migrations through a direct administrative URL:

```sh
HOOKFISH_MIGRATION_DATABASE_URL=postgres://user:pass@host:5432/dbname \
  pnpm migrate --backend cloudflare-worker
```

Store production credentials as Worker secrets and deploy:

```sh
pnpm --filter @hookfish/example-cloudflare-worker exec wrangler secret put OAUTH_ENCRYPTION_KEY
pnpm --filter @hookfish/example-cloudflare-worker exec wrangler secret put BROKER_API_KEY
pnpm --filter @hookfish/example-cloudflare-worker exec wrangler secret put GITHUB_CLIENT_ID
pnpm --filter @hookfish/example-cloudflare-worker exec wrangler secret put GITHUB_CLIENT_SECRET
pnpm --filter @hookfish/example-cloudflare-worker deploy
```

Wrangler generates `Env` from `wrangler.jsonc`; do not add a handwritten
binding interface. The checked-in `wrangler-typegen.env` contains binding names
only so secrets appear in that generated type without storing their values.
Rerun `pnpm cf-typegen` whenever a binding changes.

## Production frontend

The frontend build is static:

```sh
VITE_BACKEND_URL=https://broker.example.com pnpm --filter @hookfish/frontend build
# Publish apps/frontend/dist with SPA fallback to index.html.
```

For a same-origin deployment, leave `VITE_BACKEND_URL` unset and route `/api/*`
to the selected backend. Before exposing the dashboard in production, pass an
`authorizeBrowserRequest` runtime option to `Hookfish.init` and enforce the
application's session/authentication policy.

## Frontend hooks

`@hookfish/hooks` consumes the browser facade using the raw API's inferred
Hono types:

```ts
import { createHookfishHooks } from '@hookfish/hooks'

const hookfish = createHookfishHooks({
  baseUrl: 'https://broker.example.com/api/client',
})

function RuntimeStats() {
  const stats = hookfish.useStats()
  return stats.data?.region
}
```

The facade only forwards stats, provider metadata, connection metadata,
authorization starts, and disconnects. OAuth token retrieval, secret-vault
operations, and administration remain server-only. More detail is in
[packages/api/OAUTH.md](packages/api/OAUTH.md).

## Commands

```sh
pnpm dev
pnpm dev --no-open
pnpm dev --backend express
pnpm dev --backend nextjs
pnpm dev --backend cloudflare-worker
pnpm build
pnpm preview
pnpm migrate
pnpm migrate --backend cloudflare-worker
pnpm cf-typegen
pnpm cf-typecheck
pnpm typecheck
pnpm lint
pnpm fmt
pnpm test
pnpm deploy
```
