# TanStack Start + Hono Turborepo

This template is a PNPM/Turbo monorepo with separate apps:

- `apps/frontend`: TanStack Start React app
- `apps/server`: standalone Hono API for Cloudflare Workers

The frontend uses TanStack server functions for app-owned reads and mutations.
The Hono API exposes one query endpoint, `/api/stats`, that the frontend reads with Hono
RPC and React Query. In local development, `pnpm dev` runs both apps through
portless with HTTPS enabled:

- `https://frontend.localhost`
- `https://server.localhost`

On non-`main` branches, the branch slug is prepended to both hostnames, for
example `https://my-branch.frontend.localhost`. The frontend points to the
matching server URL automatically unless `VITE_API_BASE_URL` is set.

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
