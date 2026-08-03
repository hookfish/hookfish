# Hono Node example

This example hosts Hookfish as a standalone Hono server on Node. It uses PGlite
by default and switches to Postgres when `DATABASE_URL` is set.

It reads the same `../../apps/frontend/.env` file as the Node frontend:

```sh
cp ../../apps/frontend/.env.example ../../apps/frontend/.env
pnpm dev
```

From the repository root, `pnpm exec template serve` runs this example once and
`pnpm dev:server` runs it behind the branch-aware Portless URL.
