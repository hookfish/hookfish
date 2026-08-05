# Hono Node example

This example hosts the raw Hookfish API at `/api` and the browser facade at
`/client` on Node. It imports the root PGlite configuration.

It reads `../../apps/frontend/.env`:

```sh
cp ../../apps/frontend/.env.example ../../apps/frontend/.env
pnpm dev
```

From the repository root, run
`pnpm --filter @hookfish/example-hono-node dev` instead.
