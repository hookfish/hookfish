# TanStack Start + Hono

Node-first full-stack application with:

- `apps/frontend` — TanStack Start SSR with the Hono API mounted at `/api`
- `apps/server` — optional standalone Node API process
- `packages/api` — shared Hono API and OAuth broker
- `packages/provider` — provider contract and registry
- `packages/providers/*` — isolated provider implementations and SDKs

Cloudflare deployment is intentionally deferred. Development, SSR, the API,
and database access all run on Node.

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

PGlite data defaults to `apps/frontend/pgdata`. Set `PGLITE_DATA_DIR` to choose
another location. Embedded migrations run automatically at startup.

The application-owned [index.ts](index.ts) registers providers. Object keys are
their public slugs; provider classes do not hard-code slugs.

## API-only development

Run the same broker without the frontend:

```sh
cp apps/server/.env.example apps/server/.env
pnpm exec template serve index.ts

# Or use the branch-aware portless URL:
pnpm dev:server index.ts
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
