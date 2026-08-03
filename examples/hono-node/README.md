# Hono Node example

This example hosts Hookfish as a standalone Hono server on Node. Its Fetch
entrypoint imports the shared root `hookfish.config.ts`, which currently uses
PGlite. That file includes a commented Postgres alternative.

It reads the same `../../apps/frontend/.env` file as the Node frontend:

```sh
cp ../../apps/frontend/.env.example ../../apps/frontend/.env
pnpm dev
```

From the repository root, run
`pnpm --filter @hookfish/example-hono-node dev` instead.
