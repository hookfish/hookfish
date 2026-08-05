# Next.js example

This example mounts Hookfish and its browser facade below `/api` with a Next.js
App Router optional catch-all route. The route supplies PGlite as its runtime
database.

Next loads local environment variables from this package, so copy the shared
template before starting it:

```sh
cp ../../apps/frontend/.env.example .env.local
pnpm dev
```

Then open <http://127.0.0.1:3000/api>. From the repository root, run
`pnpm --filter @hookfish/example-nextjs dev` instead.
