# Hookfish

A portable OAuth and encrypted-secret broker with a TanStack Start frontend and
Fetch-compatible backend runtimes:

- `apps/frontend` — TanStack Start composition host with Better Auth
- `apps/inspector` — TanStack Start inspector for remote MCP servers
- `packages/browser` — TanStack Router connection-management application
- `packages/client` — authenticated browser-safe Hono application
- `packages/api` — shared Hono API and OAuth broker
- `packages/sdk` — generated, typed server client for Hookfish operations
- `packages/hooks` — typed Hono RPC clients, query options, and React hooks
- `packages/database` — PGlite, Postgres, and Durable Object adapters
- `packages/provider` and `packages/providers/*` — provider contracts and implementations
- `examples/backends/hono-node` — default Node backend using PGlite
- `examples/backends/express` and `examples/backends/nextjs` — alternative Node hosts
- `examples/backends/cloudflare-worker` — Worker backend using SQLite Durable Objects

The raw broker and frontend are separate processes. The broker exposes only
`/api/*`. The Start frontend keeps its broker credential server-side and mounts
the client Hono app at `/api/client/*`.

- raw server: `/api/*`
- frontend host: `/api/client/*`, `/api/auth/*`, and the browser application

## Local development

```sh
pnpm install
cp apps/frontend/.env.example apps/frontend/.env
# Fill OAUTH_ENCRYPTION_KEY, HOOKFISH_API_KEY, and provider credentials.

pnpm dev
# Frontend: http://127.0.0.1:5173
# Backend:  http://127.0.0.1:8787

pnpm dev --no-open
pnpm dev --backend cloudflare-worker
```

## Create a standalone project

Scaffold a deployable Hookfish backend with the dashboard development server:

```sh
npm install --global hookfish@latest
hookfish init my-broker --backend node
# Backends: vercel, cloudflare, node, bun, docker

cd my-broker
pnpm dev
# Run only the generated backend:
pnpm dev:server
```

The generated `dev:server` script runs the API-only, platform-native development
server (`vercel dev`, `wrangler dev`, Node, Bun, or Docker). The `dev` script
runs it in parallel with `hookfish serve --backend-url <backend-url>`. The
packaged Start frontend connects to that separate server and keeps
`HOOKFISH_API_KEY` out of browser code. Use `--no-install` during
initialization to skip dependency installation. The Cloudflare scaffold uses a
PostgreSQL database through Hyperdrive; the Vercel scaffold expects Postgres
through `DATABASE_URL`; Node, Bun, and Docker use PGlite by default.
Each scaffold generates a gitignored local environment file with a unique
encryption key and broker API key.

Start the standalone inspector with `npx hookfish inspect`. The `inspector`
command is an alias. In this repository, `pnpm cli inspect` runs the same
packaged server directly at `http://localhost:3000`. It mounts the raw API at
`/api`, backed by PGlite in
`~/.hookfish/inspector` by default. `HOOKFISH_API_KEY` defaults to `test` when
unset or empty. Use `INSPECTOR_PORT` to choose another port. In Conductor, the
CLI uses the third allocated workspace port automatically.

The repository's `pnpm dev` script is implemented by the private
`scripts/repo-dev` workspace and runs the selected backend plus the Start
frontend through Turbo.
Choose `hono-node` (the default), `express`, `nextjs`, or `cloudflare-worker`
with `--backend`. The default Hono backend stores PGlite data in
`pgdata` and applies embedded migrations lazily. Set `PGLITE_DATA_DIR` to move
it. In Conductor, the CLI automatically uses `CONDUCTOR_PORT` for the frontend
and the next allocated port for the backend.

Outside this repository, `hookfish dev` and its `hookfish serve` alias serve the
packaged Start frontend on loopback. An explicit backend and server-side
`HOOKFISH_API_KEY` are required.

## Pointing the local dashboard at another backend

Run any backend, then start the local frontend server:

```sh
HOOKFISH_API_KEY=your-server-key \
  pnpm cli serve --backend-url http://127.0.0.1:3000
```

The browser never receives that key and does not expose the raw API. A root key
shows the full tree. A downscoped broker token shows only its permitted paths;
a single `path/**` scope opens at `path`.

Available backends:

```sh
# PGlite on http://127.0.0.1:8787
pnpm --filter @hookfish/example-hono-node dev

# PGlite on http://127.0.0.1:3000
pnpm --filter @hookfish/example-express dev
pnpm --filter @hookfish/example-nextjs dev

# SQLite Durable Objects on http://127.0.0.1:8787
pnpm --filter @hookfish/example-cloudflare-worker dev
```

Each backend example owns its `hookfish.config.ts`, including its database,
providers, callback policy, and documentation visibility. The Node examples
store PGlite data in a local `pgdata` directory; the Worker config uses its
Durable Object binding.

## Cloudflare Worker backend

The example already declares a SQLite-backed `HookfishDurableObject` namespace
in `examples/backends/cloudflare-worker/wrangler.jsonc`. Log in and generate its runtime
types:

```sh
pnpm --filter @hookfish/example-cloudflare-worker exec wrangler login
pnpm cf-typegen
pnpm cf-typecheck
```

Wrangler persists local Durable Object state automatically. Each object applies
the bundled SQLite schema lazily when it first starts, so there is no separate
database URL or migration command for the Worker backend. The example uses one
named object for the broker database.

Store production credentials as Worker secrets and deploy:

```sh
pnpm --filter @hookfish/example-cloudflare-worker exec wrangler secret put OAUTH_ENCRYPTION_KEY
pnpm --filter @hookfish/example-cloudflare-worker exec wrangler secret put HOOKFISH_API_KEY
pnpm --filter @hookfish/example-cloudflare-worker exec wrangler secret put GITHUB_CLIENT_ID
pnpm --filter @hookfish/example-cloudflare-worker exec wrangler secret put GITHUB_CLIENT_SECRET
pnpm --filter @hookfish/example-cloudflare-worker deploy
```

Wrangler generates `Env` from `wrangler.jsonc`; do not add a handwritten
binding interface. The checked-in `wrangler-typegen.env` contains binding names
only so secrets appear in that generated type without storing their values.
Rerun `pnpm cf-typegen` whenever a binding changes.

## Product frontend

`packages/client` is a Hono app that connects server-side to a separately
running Hookfish API. Authenticate a request and return a canonical base path:

```ts
import { createHookfishClient } from '@hookfish/client'

export const client = createHookfishClient({
  backendUrl: process.env.HOOKFISH_BACKEND_URL,
  apiKey: process.env.HOOKFISH_API_KEY,
  auth: {
    async authenticate(request) {
      const session = await verifySession(request)
      if (!session) return { authenticated: false, response: new Response(null, { status: 401 }) }
      return {
        authenticated: true,
        principal: {
          subject: session.userId,
          basePath: 'organizations/acme',
        },
      }
    },
  },
})
```

The client app signs a short-lived `organizations/acme/**` capability and
preserves canonical paths end to end. `apps/frontend` is the default TanStack
Start host: Better Auth lives there, `packages/client` provides its server API,
and `packages/browser` provides its TanStack Router UI. A host can replace
Better Auth with Clerk, WorkOS, Auth0, or another provider by implementing the
same `ApplicationAuthProvider` contract. Organizations are not required;
`resolveBasePath` may simply return a constant for a single-tenant product.

## Frontend hooks

`@hookfish/hooks` consumes the authenticated application API:

```ts
import { createHookfishHooks } from '@hookfish/hooks'

const hookfish = createHookfishHooks({
  baseUrl: 'https://broker.example.com/api/client',
})

function ConnectionCount() {
  const connections = hookfish.useConnections()
  return connections.data?.connections.length
}
```

The application API exposes provider metadata, connection metadata, safe
authorization and secret-write operations, and disconnects. It never exposes
credential retrieval or administration. More detail is in
[packages/api/OAUTH.md](packages/api/OAUTH.md). For a global dynamic MCP
catalog with tenant-prefixed connections, see
[docs/SMITHERY.md](docs/SMITHERY.md).

## Commands

```sh
pnpm dev
pnpm dev --no-open
pnpm dev --backend express
pnpm dev --backend nextjs
pnpm dev --backend cloudflare-worker
pnpm run docs
pnpm build
pnpm preview
pnpm migrate
pnpm migrate --backend cloudflare-worker
pnpm cf-typegen
pnpm cf-typecheck
pnpm typecheck
pnpm lint
pnpm fmt
pnpm test
pnpm deploy
```

## License

Hookfish is licensed under the [Functional Source License 1.1 with an
attribution requirement](LICENSE).

You may use, modify, self-host, and redistribute Hookfish for any purpose other
than a Competing Use — making it available to others in a commercial product or
service that substitutes for Hookfish. Internal use, non-commercial education,
non-commercial research, and professional services around Hookfish are all
permitted. Each version becomes available under the Apache License 2.0 two
years after its release.

If you ship Hookfish inside an end-user-facing application, credit Hookfish
somewhere users can reasonably find it — an about page, a credits or
third-party licenses screen, a footer, or your documentation. Text naming
Hookfish, such as "Powered by Hookfish", linked to this repository satisfies
the requirement. `hookfish init` writes this note into the generated project's
`AGENTS.md` and `README.md`.

To request a waiver, or a commercial license permitting a Competing Use,
[open an issue](https://github.com/hookfish/hookfish/issues).
