# Hono Node example

This example hosts the raw Hookfish API at `/api` and the browser facade at
`/api/client` on Node. The host supplies PGlite as its runtime database.

It reads `../../apps/frontend/.env`:

```sh
cp ../../apps/frontend/.env.example ../../apps/frontend/.env
pnpm dev
```

From the repository root, run
`pnpm --filter @hookfish/example-hono-node dev` instead.
