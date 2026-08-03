# TanStack Start + Hono

Node-first full-stack application with reusable API and provider packages:

- `apps/frontend` — TanStack Start SSR on Node, with Hookfish mounted at `/api`
- `examples/hono-node` — standalone Hono server on Node
- `examples/cloudflare-worker` — Cloudflare Worker using Hyperdrive/Postgres
- `packages/api` — shared Hono API and OAuth broker
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
# → https://frontend.localhost
```

PGlite persists at `pgdata` in the project root and applies embedded migrations
automatically. Set `PGLITE_DATA_DIR` to move it or `DATABASE_URL` to use Postgres.

## Hono Node example

The standalone example reads the same `apps/frontend/.env` file:

```sh
pnpm --filter @template/example-hono-node dev

# Or through the repository CLI:
pnpm exec template serve
pnpm dev:server
```

`pnpm dev:server` exposes the server through the branch-aware Portless URL.

## Cloudflare Worker example

Authenticate Wrangler and create a Hyperdrive configuration for Postgres:

```sh
pnpm --filter @template/example-cloudflare-worker exec wrangler login
pnpm --filter @template/example-cloudflare-worker exec wrangler hyperdrive create hookfish-db \
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

pnpm --filter @template/example-cloudflare-worker dev
```

Run migrations directly against Postgres before deployment:

```sh
DATABASE_URL=postgres://user:pass@host:5432/dbname pnpm migrate
```

Store deployed credentials with Wrangler, repeating for each provider used by
the Worker:

```sh
pnpm --filter @template/example-cloudflare-worker exec wrangler secret put OAUTH_ENCRYPTION_KEY
pnpm --filter @template/example-cloudflare-worker exec wrangler secret put BROKER_API_KEY
```

Deploy the Worker example:

```sh
pnpm --filter @template/example-cloudflare-worker deploy
# Equivalent root command; only this example defines a deploy task.
pnpm deploy
```

## Production Node frontend

Build the Nitro Node server and start its generated entrypoint:

```sh
pnpm build
pnpm --filter @template/frontend start
```

Provide secrets as process environment variables. Without `DATABASE_URL`, the
server uses PGlite. For production Postgres, run migrations before starting.

More detail on the broker, custom providers, and endpoints is in
[packages/api/OAUTH.md](packages/api/OAUTH.md).

## Commands

```sh
pnpm dev            # Node SSR + mounted Hookfish API
pnpm dev:server     # Hono Node example through Portless
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
