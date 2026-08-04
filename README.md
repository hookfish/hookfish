# TanStack Start + Hono

Node-first full-stack application with reusable API and provider packages:

- `apps/frontend` — TanStack Start SSR on Node, with Hookfish mounted at `/api`
- `examples/hono-node` — standalone Hono server on Node
- `examples/express` — Express server with Hookfish mounted at `/api`
- `examples/nextjs` — Next.js App Router application with Hookfish route handlers
- `examples/cloudflare-worker` — Cloudflare Worker using Hyperdrive/Postgres
- `hookfish.config.ts` — shared database, provider, and Hookfish configuration
- `packages/api` — shared Hono API and OAuth broker
- `packages/hooks` — typed Hono RPC clients, React Query options, and hooks
- `packages/database` — request-aware Postgres and local PGlite bindings
- `packages/provider` and `packages/providers/*` — provider contracts and implementations

The frontend stays on Node. Cloudflare configuration, Wrangler, and generated
runtime types are isolated to the Worker example.

## Local frontend development

The Node frontend defaults to PGlite, so no database service is required.

```sh
pnpm install
cp apps/frontend/.env.example apps/frontend/.env
# Fill OAUTH_ENCRYPTION_KEY, BROKER_API_KEY, and provider credentials.

pnpm dev
# Equivalent: pnpm exec hookfish serve
# → http://127.0.0.1:5173
```

The root `hookfish.config.ts` uses PGlite, persists it at `pgdata`, and applies
embedded migrations automatically. Set `PGLITE_DATA_DIR` to move it. Commented
examples in that file show how to switch to Postgres or Hyperdrive. The
frontend and examples all import the same Hookfish instance.

## Hono Node example

The standalone example reads the same `apps/frontend/.env` file:

```sh
pnpm --filter @hookfish/example-hono-node dev
```

## Express example

The Express example adapts Hookfish's Fetch handler to Node's request and
response objects. It reads the same `apps/frontend/.env` file:

```sh
pnpm --filter @hookfish/example-express dev
# → http://127.0.0.1:3000/api
```

## Next.js example

The Next.js App Router example forwards every `/api/*` route to Hookfish. Next
loads environment variables from the example's `.env.local` file:

```sh
cp apps/frontend/.env.example examples/nextjs/.env.local
pnpm --filter @hookfish/example-nextjs dev
# → http://127.0.0.1:3000/api
```

## Cloudflare Worker example

Before running the Worker, replace the active PGlite database in
`hookfish.config.ts` with its commented Hyperdrive configuration.

Authenticate Wrangler and create a Hyperdrive configuration for Postgres:

```sh
pnpm --filter @hookfish/example-cloudflare-worker exec wrangler login
pnpm --filter @hookfish/example-cloudflare-worker exec wrangler hyperdrive create hookfish-db \
  --connection-string="postgres://user:pass@host:5432/dbname"
```

Replace `<YOUR_HYPERDRIVE_ID>` in
`examples/cloudflare-worker/wrangler.jsonc`, then regenerate the checked-in
Cloudflare runtime and binding declarations:

```sh
pnpm cf-typegen
pnpm cf-typecheck
```

Do not add a handwritten `Env` or binding interface. Change `wrangler.jsonc`
and rerun `pnpm cf-typegen` whenever a binding changes.

The Worker also reads `apps/frontend/.env` during local development. Workers
need Postgres, so add the local Hyperdrive connection string to that file:

```sh
# apps/frontend/.env
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://user:pass@127.0.0.1:5432/dbname

pnpm --filter @hookfish/example-cloudflare-worker dev
```

Run migrations before deployment. The CLI loads `hookfish.config.ts` and uses
its configured database. For Postgres deployment, switch to the commented
Postgres configuration and set `DATABASE_URL`:

```sh
DATABASE_URL=postgres://user:pass@host:5432/dbname pnpm migrate
```

Store deployed credentials with Wrangler, repeating for each provider used by
the Worker:

```sh
pnpm --filter @hookfish/example-cloudflare-worker exec wrangler secret put OAUTH_ENCRYPTION_KEY
pnpm --filter @hookfish/example-cloudflare-worker exec wrangler secret put BROKER_API_KEY
```

Deploy the Worker example:

```sh
pnpm --filter @hookfish/example-cloudflare-worker deploy
# Equivalent root command; only this example defines a deploy task.
pnpm deploy
```

## Production Node frontend

Build the Nitro Node server and start its generated entrypoint:

```sh
pnpm build
pnpm --filter @hookfish/frontend start
```

Provide secrets as process environment variables. The root Hookfish config uses
PGlite by default. For production Postgres, switch to the commented Postgres
configuration and run migrations before starting.

More detail on the broker, custom providers, and endpoints is in
[packages/api/OAUTH.md](packages/api/OAUTH.md).

## Frontend hooks

`@hookfish/hooks` wraps the API's exported Hono RPC type with reusable React
Query options and hooks:

```ts
import { createHookfishHooks } from '@hookfish/hooks'

const hookfish = createHookfishHooks({ baseUrl: '/api' })

function RuntimeStats() {
  const stats = hookfish.useStats()
  return stats.data?.region
}
```

The TanStack Start frontend sends protected hook operations through an
allowlisted server function that injects `BROKER_API_KEY`; the secret never
enters the browser bundle. Access-token retrieval remains server-only and is
intentionally omitted from both the hooks and the server-function proxy.

## Commands

```sh
pnpm dev            # Node SSR + mounted Hookfish API
pnpm build
pnpm preview
pnpm migrate
pnpm cf-typegen     # regenerate Worker declarations with Wrangler
pnpm cf-typecheck   # verify generated Worker declarations
pnpm typecheck
pnpm lint
pnpm fmt
pnpm test
pnpm deploy         # deploy the Cloudflare Worker example
```

The product CLI intentionally exposes only the mounted frontend, migrations,
and help:

```sh
pnpm exec hookfish serve
pnpm exec hookfish migrate
pnpm exec hookfish help
```
