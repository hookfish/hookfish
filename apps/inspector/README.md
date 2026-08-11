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
# https://inspector.localhost
```

This uses Portless with HTTPS and treats `PORTLESS_URL` as the canonical public
origin for OAuth redirects and trusted return URLs. Portless requires Node.js
24 or newer. Use `dev:direct` to run Vite directly without the HTTPS proxy.

```bash
npx hookfish inspect
# alias: npx hookfish inspector
# https://inspector.localhost
```

The packaged CLI starts Portless automatically. If another process owns
`inspector.localhost`, it receives `SIGTERM` before the inspector takes over
the route. Set `HOOKFISH_INSPECTOR_URL` only when intentionally running the
packaged server behind a different proxy or direct origin.

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
