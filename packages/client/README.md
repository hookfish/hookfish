# `@hookfish/client`

Server-side, browser-safe Hono app for a separately deployed Hookfish raw API.

The host application authenticates each request and resolves a canonical
resource base path. The facade signs a short-lived capability for that subtree,
forwards an explicit set of safe connection-management operations, and never
returns provider credentials or the broker root key to browser code.

Return `basePath: null` to retain `apiKey`'s own root or downscoped grant. The
client reads `/api/access` so a single subtree scope can become the browser
view root without exposing the token.

```ts
import { createHookfishClient } from '@hookfish/client'

export const client = createHookfishClient({
  auth: { authenticate: authenticateApplicationRequest },
  backendUrl: 'http://127.0.0.1:8787',
  apiKey: process.env.HOOKFISH_API_KEY,
})

app.route('/', client)
```
