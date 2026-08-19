# @hookfish/client

Mountable Hono facade for the Hookfish operator frontend. It connects a browser
application to a separately running Hookfish API while keeping the root API key
on the server.

```ts
import { createHookfishClient } from '@hookfish/client'

const client = createHookfishClient({
  apiUrl: 'http://127.0.0.1:8787',
  apiKey: () => process.env.HOOKFISH_API_KEY!,
  frontendOrigin: 'http://127.0.0.1:5173',
  sessionToken: crypto.randomUUID(),
  fallback: (request) => frontend.fetch(request),
})

export default client
```

The Hono app exposes the operator-safe `/api/client/*` routes and public OAuth
callback routes. It never proxies the raw Hookfish API or sends `apiKey` to the
browser. If `fallback` is provided, non-client requests are delegated to it so
the facade can wrap a frontend server such as TanStack Start.
