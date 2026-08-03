# Hono Node example

This example hosts Hookfish as a standalone Hono server on Node. It uses PGlite
by default and switches to Postgres when `DATABASE_URL` is set.

It reads the same `../../apps/frontend/.env` file as the Node frontend:

```sh
cp ../../apps/frontend/.env.example ../../apps/frontend/.env
pnpm dev
```

From the repository root, run
`pnpm --filter @template/example-hono-node dev` instead.
