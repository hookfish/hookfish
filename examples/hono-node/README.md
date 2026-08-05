# Hono Node example

This example hosts the raw Hookfish API at `/api` and the browser facade at
`/api/client` on Node. It uses the PGlite database from the root config.

It reads `../../apps/frontend/.env`:

```sh
cp ../../apps/frontend/.env.example ../../apps/frontend/.env
pnpm dev
```

From the repository root, run
`pnpm --filter @hookfish/example-hono-node dev` instead.
