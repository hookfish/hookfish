# Hono Node example

This example hosts only the raw Hookfish API at `/api` on Node. The separate
frontend points its client Hono app at this server. The local
`hookfish.config.ts` stores PGlite data in `pgdata` by default.

It reads `../../../apps/frontend/.env`:

```sh
cp ../../../apps/frontend/.env.example ../../../apps/frontend/.env
pnpm dev
```

From the repository root, run
`pnpm --filter @hookfish/example-hono-node dev` instead.
