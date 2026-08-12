# Hookfish

A portable OAuth and encrypted-secret broker with a static React dashboard and Fetch-compatible
backend runtimes:

- `apps/frontend` — Vite SPA with TanStack Router and React Query
- `apps/inspector` — TanStack Start inspector for remote MCP servers
- `packages/backend` — browser-safe facade plus raw Hookfish API composition
- `packages/api` — shared Hono API and OAuth broker
- `packages/sdk` — generated, typed server client for Hookfish operations
- `packages/hooks` — typed Hono RPC clients, query options, and React hooks
- `packages/database` — PGlite, Postgres, and Durable Object adapters
- `packages/provider` and `packages/providers/*` — provider contracts and implementations
- `examples/backends/hono-node` — default Node backend using PGlite
- `examples/backends/express` and `examples/backends/nextjs` — alternative Node hosts
- `examples/backends/cloudflare-worker` — Worker backend using SQLite Durable Objects
- `examples/chatbot` — shadcn chatbot with Better Auth and per-user Hookfish secrets in PGlite

The frontend contains no server functions or database code. Every host exposes:

- `/api/*` — raw Hookfish API, documentation, and OAuth callbacks
- `/api/client/*` — allowlisted browser facade with server-side broker credentials

## Local development

```sh
pnpm install
cp apps/frontend/.env.example apps/frontend/.env
# Fill OAUTH_ENCRYPTION_KEY, HOOKFISH_API_KEY, and provider credentials.

pnpm dev
# Frontend: http://127.0.0.1:5173
# Backend:  http://127.0.0.1:8787

pnpm dev --no-open
pnpm dev --backend cloudflare-worker
```

## Create a standalone project

Scaffold a deployable Hookfish backend with the dashboard development server:

```sh
npm install --global hookfish@latest
hookfish init my-broker --backend node
# Backends: vercel, cloudflare, node, bun, docker

cd my-broker
pnpm dev
# Run only the generated backend:
pnpm dev:server
```

The generated `dev:server` script runs the platform-native development server
(`vercel dev`, `wrangler dev`, Node, Bun, or Docker). The `dev` script runs it in
parallel with `hookfish serve --backend-url <backend-url>`, which serves the
packaged frontend and proxies `/api` to that backend. Use `--no-install` during
initialization to skip dependency installation. The Cloudflare scaffold uses a
SQLite-backed Durable Object; the Vercel scaffold expects Postgres through
`DATABASE_URL`; Node, Bun, and Docker use PGlite by default.
Each scaffold generates a gitignored local environment file with a unique
encryption key and broker API key.

Start the standalone inspector with `npx hookfish inspect`. The `inspector`
command is an alias. In this repository, `pnpm cli inspect` runs the same
packaged server directly at `http://localhost:3000`. It mounts the raw API at
`/api` and the browser client facade at `/api/client`, backed by PGlite in
`~/.hookfish/inspector` by default. `HOOKFISH_API_KEY` defaults to `test` when
unset or empty. Use `INSPECTOR_PORT` to choose another port. In Conductor, the
CLI uses the third allocated workspace port automatically.

The repository's `pnpm dev` script delegates to `turbo dev` filtered to the
frontend and the selected backend. Choose `hono-node` (the default), `express`,
`nextjs`, or `cloudflare-worker` with `--backend`. The Vite server proxies
`/api` to that backend. The default Hono backend stores PGlite data in
`pgdata` and applies embedded migrations lazily. Set `PGLITE_DATA_DIR` to move
it. In Conductor, the CLI automatically uses `CONDUCTOR_PORT` for the frontend
and the next allocated port for the backend.

Outside this repository, `hookfish dev` and its `hookfish serve` alias serve the
packaged dashboard and proxy `/api` to a backend. An explicit backend is
required through `--backend-url` or `HOOKFISH_BACKEND_URL`.

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

# SQLite Durable Objects on http://127.0.0.1:8787
pnpm --filter @hookfish/example-cloudflare-worker dev
```

Each backend example owns its `hookfish.config.ts`, including its database,
providers, browser policy, and documentation visibility. The Node examples
store PGlite data in a local `pgdata` directory; the Worker config uses its
Durable Object binding.

Run the full-stack chatbot example separately:

```sh
pnpm --filter @hookfish/example-chatbot dev
```

See [`examples/chatbot/README.md`](examples/chatbot/README.md) for its local
environment and account setup.

## Cloudflare Worker backend

The example already declares a SQLite-backed `HookfishDurableObject` namespace
in `examples/backends/cloudflare-worker/wrangler.jsonc`. Log in and generate its runtime
types:

```sh
pnpm --filter @hookfish/example-cloudflare-worker exec wrangler login
pnpm cf-typegen
pnpm cf-typecheck
```

Wrangler persists local Durable Object state automatically. Each object applies
the bundled SQLite schema lazily when it first starts, so there is no separate
database URL or migration command for the Worker backend. Organization routing
uses one named object per organization; global routes use a reserved global
object.

Store production credentials as Worker secrets and deploy:

```sh
pnpm --filter @hookfish/example-cloudflare-worker exec wrangler secret put OAUTH_ENCRYPTION_KEY
pnpm --filter @hookfish/example-cloudflare-worker exec wrangler secret put HOOKFISH_API_KEY
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
`authorizeBrowserRequest` runtime option to `HookfishServer.init` and enforce the
application's session/authentication policy.

The bundled dashboard currently shows global routes only. It has no
organization selector, and `/connections/acme` means the `acme` resource
folder rather than the `acme` organization. An organization-aware product
should expose its own authenticated route, such as
`/organizations/acme/connections`, and call Hookfish's organization API from
its server. See [docs/SMITHERY.md](docs/SMITHERY.md#frontend-organization-views).

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
[packages/api/OAUTH.md](packages/api/OAUTH.md). For a global dynamic MCP
catalog with organization-scoped connections, see
[docs/SMITHERY.md](docs/SMITHERY.md).

## Commands

```sh
pnpm dev
pnpm dev --no-open
pnpm dev --backend express
pnpm dev --backend nextjs
pnpm dev --backend cloudflare-worker
pnpm run docs
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
