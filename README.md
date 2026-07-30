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

pnpm migrate   # apply schema to local PGlite (apps/server/pgdata)
pnpm dev
# → https://frontend.localhost
#    /api is served by Node + PGlite via the Vite plugin
```

API only:

```sh
pnpm migrate
pnpm --filter @template/server dev
```

### 2. Production — Node + Postgres

Point at any Postgres with `DATABASE_URL`. The Node entrypoint builds a pooled
client and injects it as `env.DB`. Run migrations before starting:

```sh
cp apps/server/.env.example apps/server/.env
# Set at least:
#   DATABASE_URL=postgres://user:pass@host:5432/dbname
#   OAUTH_ENCRYPTION_KEY=...
#   BROKER_API_KEY=...
#   OAUTH_REDIRECT_BASE_URL=https://your.api.host   # if not inferable from the request

pnpm install
DATABASE_URL=postgres://user:pass@host:5432/dbname pnpm migrate
pnpm --filter @template/server build
pnpm --filter @template/server dev:node
# Or run the built Node process under your process manager the same way —
# createLocalBrokerEnv reads DATABASE_URL from the environment.
```

### 3. Local — Cloudflare Workers

Exercise the Workers runtime against Postgres. PGlite cannot persist in workerd.

**API Worker** (`apps/server`):

```sh
cp apps/server/.env.example apps/server/.env
# Put DATABASE_URL in apps/server/.dev.vars so workerd can reach Postgres.

pnpm --filter @template/server dev:worker
```

**Frontend** (`pnpm dev`) still serves `/api` from Node (Vite plugin) for fast
local DX, while SSR runs via the Cloudflare Vite plugin. To hit the Worker API
path locally, use `dev:worker` above (or point the frontend at that origin).

### 4. Production — Cloudflare Workers

Nothing account-specific is committed. The `wrangler.jsonc` files hold only
portable settings; your Hyperdrive id, Worker names, and secrets stay local.

```sh
wrangler login
cp .env.example .env    # gitignored
```

**Database.** Either Hyperdrive (pooling + caching at the edge):

```sh
pnpm --filter @template/server exec wrangler hyperdrive create my-db \
  --connection-string="postgres://user:pass@host:5432/dbname"
# Put the returned id in .env as HYPERDRIVE_ID.
```

Deploying merges it into a gitignored `wrangler.deploy.json` and ships that —
see [scripts/wrangler-deploy.mjs](scripts/wrangler-deploy.mjs). Wrangler does not
interpolate environment variables inside its own config, which is why the merge
happens outside it.

Or skip Hyperdrive and leave `HYPERDRIVE_ID` unset:

```sh
pnpm --filter @template/frontend exec wrangler secret put DATABASE_URL
pnpm --filter @template/server exec wrangler secret put DATABASE_URL
```

**Secrets.** Deploying uploads `apps/<app>/.env` with the version, so the
Worker's runtime config is whatever that app's `.env` says — fill in
`OAUTH_ENCRYPTION_KEY`, `BROKER_API_KEY`, and any provider credentials there and
they ship on the next deploy. Uploads are additive: keys you leave out keep
their current value rather than being deleted.

The two `.env` layers are not interchangeable:

| File | Holds | Uploaded? |
| --- | --- | --- |
| `<repo>/.env` | `HYPERDRIVE_ID`, `CLOUDFLARE_*` | never |
| `apps/<app>/.env` | the Worker's runtime secrets | yes, with each deploy |

`HYPERDRIVE_ID`, `WORKER_NAME`, `SKIP_SECRET_UPLOAD`, and `CLOUDFLARE_*` are
stripped before upload wherever they appear — they configure the deploy, not the
Worker, and an uploaded `CLOUDFLARE_API_TOKEN` would hand the Worker your
account. To ship code without touching live secrets:

```sh
SKIP_SECRET_UPLOAD=1 pnpm --filter @template/frontend run deploy
```

**Names and routes.** Set `WORKER_NAME` in `apps/frontend/.env` /
`apps/server/.env` to override the placeholder names, and pass routes through as
flags rather than committing them.

**Deploy.** Note the `run` — `pnpm deploy` without it hits pnpm's built-in
`deploy` command instead of this script:

```sh
pnpm run deploy                                 # both Workers, via turbo

pnpm --filter @template/frontend run deploy      # just the frontend
pnpm --filter @template/server run deploy        # just the API Worker

# Extra wrangler flags pass straight through:
pnpm --filter @template/frontend run deploy -- --domains app.example.com
pnpm --filter @template/frontend run deploy -- --dry-run
```

In CI, set the same names as repository secrets — real environment variables win
over `.env`, so no file is needed. `CLOUDFLARE_API_TOKEN` (Workers Scripts:
Edit) and `CLOUDFLARE_ACCOUNT_ID` replace `wrangler login`.

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
pnpm migrate      # drizzle-kit against DATABASE_URL or local PGlite
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
pnpm fmt
pnpm test
pnpm run deploy   # `run` is required -- `pnpm deploy` is a pnpm builtin
```

Regenerate Worker environment types after changing either app's `wrangler.jsonc`:

```sh
pnpm cf-typegen
```
