# TanStack Start + Hono

Node-first full-stack application with:

- `apps/frontend` — TanStack Start SSR with the Hono API mounted at `/api`
- `apps/server` — optional standalone Node API process
- `packages/api` — shared Hono API and OAuth broker
- `packages/database` — runtime-selectable Postgres and PGlite bindings
- `packages/provider` — provider contract and registry
- `packages/providers/*` — isolated provider implementations and SDKs

Cloudflare deployment and Hyperdrive wiring are intentionally deferred. The API
uses Fetch and accepts request-time bindings, so adding an edge database adapter
does not require changing its routes.

## Local development

The default database is PGlite, so no database service is required. TanStack
Start and the mounted Hono API run in the same Node process.

```sh
pnpm install
cp apps/server/.env.example apps/frontend/.env
# Fill OAUTH_ENCRYPTION_KEY, BROKER_API_KEY, and provider credentials.

pnpm dev
# → https://frontend.localhost
```

PGlite data defaults to `pgdata` at the project root. Set `PGLITE_DATA_DIR` to choose
another location. Embedded migrations run automatically at startup.

Each host constructs `Hookfish` next to its Fetch entrypoint:
[`apps/frontend/src/server.ts`](apps/frontend/src/server.ts) for the frontend and
[`apps/server/src/node.ts`](apps/server/src/node.ts) for the standalone server.
Each chooses a database and providers before constructing `Hookfish`. Object
keys are provider slugs; provider classes do not hard-code them.

```ts
import { Hookfish } from '@template/api'
import { pglite } from '@template/database/pglite'
import { postgres } from '@template/database/postgres'
import { NotionProvider } from '@template/provider-notion'

const hookfish = new Hookfish({
  db: process.env.DATABASE_URL
    ? postgres(process.env.DATABASE_URL)
    : pglite('./pgdata'),
  providers: { notion: new NotionProvider() },
})

export default hookfish
```

## API-only development

Run the same broker without the frontend:

```sh
cp apps/server/.env.example apps/server/.env
pnpm exec template serve

# Or use the branch-aware portless URL:
pnpm dev:server
```

## Production Node deployment

Build the frontend as a Nitro Node server and start its generated entrypoint:

```sh
pnpm build
pnpm --filter @template/frontend start
```

Provide secrets as process environment variables. Without `DATABASE_URL`, the
server uses PGlite. For production Postgres, set `DATABASE_URL` and run
migrations before starting:

```sh
DATABASE_URL=postgres://user:pass@host:5432/dbname pnpm migrate
DATABASE_URL=postgres://user:pass@host:5432/dbname \
  pnpm --filter @template/frontend start
```

The standalone API uses the same database rules:

```sh
DATABASE_URL=postgres://user:pass@host:5432/dbname \
  pnpm --filter @template/server dev:node
```

More detail on the broker, custom providers, and endpoints is in
[packages/api/OAUTH.md](packages/api/OAUTH.md).

## Commands

```sh
pnpm dev          # Node SSR + mounted Hono API
pnpm dev:server   # standalone Node API through portless
pnpm build        # Nitro Node production build
pnpm preview      # run the built Node server
pnpm migrate      # apply Postgres migrations
pnpm typecheck
pnpm lint
pnpm fmt
pnpm test
```
