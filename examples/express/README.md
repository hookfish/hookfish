# Express example

This example mounts Hookfish at `/api` in an Express 5 server. The Hono Node
adapter translates Express's Node request and response objects to Hookfish's
Fetch-compatible handler without changing the request URL.

It reads the same `../../apps/frontend/.env` file as the Node frontend:

```sh
cp ../../apps/frontend/.env.example ../../apps/frontend/.env
pnpm dev
```

Then open <http://127.0.0.1:3000/api>. From the repository root, run
`pnpm --filter @hookfish/example-express dev` instead.
