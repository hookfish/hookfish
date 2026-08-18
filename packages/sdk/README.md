# `@hookfish/sdk`

Typed server-side client for Hookfish.

```ts
import { Hookfish } from '@hookfish/sdk'

const hookfish = new Hookfish({
  apiKey: process.env.HOOKFISH_API_KEY!,
  baseUrl: 'http://127.0.0.1:8787/api',
})

await using mcp = await hookfish.mcp({
  connection: 'user/personal/gmail/mcp',
  url: 'https://gmail.run.tools',
})

const tools = await mcp.listTools()
```

Initial authorization and an upstream MCP `401` throw `HookfishError` with the
stable `authorization_required` code and a fresh `authorizeUrl`. An unhandled
`HookfishError` also preserves its HTTP response through Hono's default error
handler.

The default MCP client identifies itself with the installed `@hookfish/sdk`
name and version. Pass an unconnected `Client` through the optional `client`
property to customize it; Hookfish connects and returns the same instance.
Returned MCP clients support `await using` and close when the current scope
exits.

Configure a GitHub connection to get an authenticated Octokit client:

```ts
const hookfish = new Hookfish({
  apiKey: process.env.HOOKFISH_API_KEY!,
  baseUrl: 'http://127.0.0.1:8787/api',
})

const github = await hookfish.github('user/personal/github')
const { data: user } = await github.rest.users.getAuthenticated()
```

Keep successful connection access responses in trusted server code.
