# TanStack Start + Hono Turborepo

This template is a PNPM/Turbo monorepo with:

- `packages/api`: shared Hono API (stats + OAuth broker)
- `apps/frontend`: TanStack Start React app with `/api/*` mounted to that Hono app
- `apps/server`: optional standalone runner for the same API (Node + PGlite, or Workers)

The frontend uses TanStack server functions for app-owned reads and mutations.
The Hono API exposes `/api/stats` (and the [OAuth broker](packages/api/OAUTH.md))
on the same origin. In local development, `pnpm dev` starts only the frontend
through portless with HTTPS:

- `https://frontend.localhost`

On non-`main` branches, the branch slug is prepended, for example
`https://my-branch.frontend.localhost`.

Locally the API uses an embedded PGlite database in `apps/server/pgdata` (both
`pnpm dev` and the standalone server), so there is no database to provision and
no `DATABASE_URL` to set. Deployed Workers use HTTP Postgres instead — see
[the OAuth broker docs](packages/api/OAUTH.md). To run the API alone:

```sh
pnpm --filter @template/server dev
```

## Commands

```sh
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
pnpm fmt
pnpm deploy
```

Regenerate Worker environment types after changing either app's `wrangler.jsonc`:

```sh
pnpm cf-typegen
```
