# Express example

This example mounts only the raw Hookfish API at `/api` in Express 5. The Hono
Node adapter translates Express requests to the shared Fetch-compatible
backend. The separate frontend points its client Hono app at this server.

Its local `hookfish.config.ts` stores PGlite data in `pgdata` by default.

It reads `../../../apps/frontend/.env`:

```sh
cp ../../../apps/frontend/.env.example ../../../apps/frontend/.env
pnpm dev
```

Then open <http://127.0.0.1:3000/api>. From the repository root, run
`pnpm --filter @hookfish/example-express dev` instead.
