# Next.js example

This example mounts Hookfish at `/api` and the browser facade at `/client`
with Next.js App Router optional catch-all routes. It uses Node because the
root runtime config defaults to PGlite.

Next loads local environment variables from this package, so copy the shared
template before starting it:

```sh
cp ../../apps/frontend/.env.example .env.local
pnpm dev
```

Then open <http://127.0.0.1:3000/api>. From the repository root, run
`pnpm --filter @hookfish/example-nextjs dev` instead.
