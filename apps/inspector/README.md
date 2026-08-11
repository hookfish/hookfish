# @hookfish/inspector

A TanStack Start interface for discovering and executing capabilities on remote
MCP servers. Saved endpoints remain in local browser storage, while MCP and
OAuth requests run on the server.

The Hookfish API and browser-safe client facade are mounted at `/api` and
`/api/client`. Both use PGlite. Set `HOOKFISH_API_KEY` to override the local
API key; when it is unset or empty, the inspector uses `test`.
If `OAUTH_ENCRYPTION_KEY` is unset, the inspector creates a private development
key inside its ignored PGlite data directory and reuses it across restarts.

For development, run:

```bash
pnpm --filter @hookfish/inspector dev
# http://localhost:3000
```

This runs Vite directly on loopback. Use `INSPECTOR_HOST` and `INSPECTOR_PORT`
to override its bind address and port.

```bash
npx hookfish inspect
# alias: npx hookfish inspector
# http://localhost:3000
```

The packaged CLI starts the server directly on loopback. Set `INSPECTOR_PORT`
to choose another port, or set `HOOKFISH_INSPECTOR_URL` when intentionally
running it behind a proxy with a different public origin. In Conductor, the CLI
uses the third allocated workspace port automatically.

The published CLI bundles the production app, so it does not require a
Hookfish checkout or pnpm workspace. It stores PGlite data in
`~/.hookfish/inspector` unless `PGLITE_DATA_DIR` is set.

The inspector supports Streamable HTTP with HTTP + SSE fallback, and displays
tools, resources, resource templates, prompts, server metadata, and raw results.
Tool, resource, and prompt execution supports form and URL elicitation, including
URL completion notifications and manual retry. Hookfish handles OAuth discovery,
PKCE, dynamic client registration, encrypted token persistence, refresh, and
server-side token access.

Build the production app with:

```bash
pnpm build
```
