# Express example

This example mounts the raw Hookfish API at `/api` and the browser facade at
`/api/client` in Express 5. The Hono Node adapter translates Express requests to
the shared Fetch-compatible backend.

It reads `../../apps/frontend/.env`:

```sh
cp ../../apps/frontend/.env.example ../../apps/frontend/.env
pnpm dev
```

Then open <http://127.0.0.1:3000/api>. From the repository root, run
`pnpm --filter @hookfish/example-express dev` instead.
