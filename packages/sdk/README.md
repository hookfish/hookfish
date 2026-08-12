# `@hookfish/sdk`

Typed server-side client for Hookfish.

```ts
import { Hookfish } from '@hookfish/sdk'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const hookfish = new Hookfish({
  apiKey: process.env.HOOKFISH_API_KEY!,
  baseUrl: 'http://127.0.0.1:8787/api',
})

const mcpUrl = new URL('https://gmail.run.tools')
const connection = {
  path: 'user/personal/gmail/mcp',
  input: { url: mcpUrl.href },
}
const authProvider = {
  token: async () =>
    (await hookfish.connections.access(connection.path, connection.input))
      .secret,
  onUnauthorized: async () => {
    await hookfish.connections.authorize(connection.path, connection.input)
  },
}
const transport = new StreamableHTTPClientTransport(mcpUrl, { authProvider })
```

Initial authorization and an upstream MCP `401` throw `HookfishError` with the
stable `authorization_required` code and a fresh `authorizeUrl`.

Keep successful connection access responses in trusted server code.
