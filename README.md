# TanStack Start + Hono Turborepo

PNPM/Turbo monorepo with:

- `packages/api` — shared Hono API (stats + [OAuth broker](packages/api/OAUTH.md))
- `apps/frontend` — TanStack Start React app; `/api/*` mounts the same Hono app
- `apps/server` — optional standalone API runner (Node or Workers)

In local development, `pnpm dev` starts the frontend through portless with HTTPS
at `https://frontend.localhost` (non-`main` branches get a slug prefix, e.g.
`https://my-branch.frontend.localhost`).

## Running

Pick the mode that matches how you want to run. Database resolution in
`@template/api` is: injected `env.DB` → `env.HYPERDRIVE` → `env.DATABASE_URL`.

### 1. Local — Node + PGlite

Default local path. No Postgres to provision; data lands in `apps/server/pgdata`.

```sh
pnpm install
cp apps/server/.env.example apps/server/.env
# Fill OAUTH_ENCRYPTION_KEY / BROKER_API_KEY (and provider creds if you need them).
# Leave DATABASE_URL unset.

pnpm dev
# → https://frontend.localhost
#    /api is served by Node + PGlite via the Vite plugin
```

API only:

```sh
pnpm --filter @template/server dev
```

### 2. Production — Node + Postgres

Point at any Postgres with `DATABASE_URL`. The Node entrypoint builds a pooled
client, applies migrations, and injects it as `env.DB`.

```sh
cp apps/server/.env.example apps/server/.env
# Set at least:
#   DATABASE_URL=postgres://user:pass@host:5432/dbname
#   OAUTH_ENCRYPTION_KEY=...
#   BROKER_API_KEY=...
#   OAUTH_REDIRECT_BASE_URL=https://your.api.host   # if not inferable from the request

pnpm install
pnpm --filter @template/server build
pnpm --filter @template/server dev:node
# Or run the built Node process under your process manager the same way —
# createLocalBrokerEnv reads DATABASE_URL from the environment.
```

Apply migrations on their own (optional; startup also migrates):

```sh
DATABASE_URL=postgres://user:pass@host:5432/dbname \
  pnpm --filter @template/api db:migrate
```

### 3. Local — Cloudflare Workers

Exercise the Workers runtime against Postgres. PGlite cannot persist in workerd.

**API Worker** (`apps/server`):

```sh
cp apps/server/.env.example apps/server/.env
# Prefer Hyperdrive for the CF path:
#   1. wrangler hyperdrive create <name> --connection-string="postgres://..."
#   2. Uncomment the hyperdrive block in apps/server/wrangler.jsonc
#      (binding must be named HYPERDRIVE; set id + localConnectionString)
# Or skip Hyperdrive and put DATABASE_URL in apps/server/.dev.vars

pnpm --filter @template/server dev:worker
```

**Frontend** (`pnpm dev`) still serves `/api` from Node (Vite plugin) for fast
local DX, while SSR runs via the Cloudflare Vite plugin. To hit the Worker API
path locally, use `dev:worker` above (or point the frontend at that origin).

### 4. Production — Cloudflare Workers

```sh
# Create Hyperdrive against your Postgres, then uncomment + fill the hyperdrive
# block in both:
#   apps/frontend/wrangler.jsonc
#   apps/server/wrangler.jsonc
# Binding name must be HYPERDRIVE.
#
# Or, without Hyperdrive:
#   pnpm --filter @template/frontend exec wrangler secret put DATABASE_URL
#   pnpm --filter @template/server exec wrangler secret put DATABASE_URL

# Push the rest of the secrets (encryption key, broker key, provider creds, …):
pnpm --filter @template/frontend exec wrangler secret put OAUTH_ENCRYPTION_KEY
pnpm --filter @template/frontend exec wrangler secret put BROKER_API_KEY
# …same for apps/server if you deploy that Worker too

pnpm deploy
```

Run migrations against the production database from your machine before or after
deploy:

```sh
DATABASE_URL=postgres://user:pass@host:5432/dbname \
  pnpm --filter @template/api db:migrate
```

More detail on the OAuth broker, providers, and DB resolution:
[packages/api/OAUTH.md](packages/api/OAUTH.md).

## Commands

```sh
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
pnpm fmt
pnpm deploy
pnpm test
```

Regenerate Worker environment types after changing either app's `wrangler.jsonc`:

```sh
pnpm cf-typegen
```
