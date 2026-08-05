# `@hookfish/backend`

Fetch-compatible composition layer for a Hookfish deployment.

- `/api/*` exposes the raw Hookfish API and OAuth callback surface.
- `/client/*` is a browser-safe facade that forwards an allowlisted subset to
  Hookfish with a server-side broker credential.
- `/client/health` reports the selected host runtime.

```ts
import { createHookfishBackend } from '@hookfish/backend'

const backend = createHookfishBackend({
  hookfishFetch: hookfish.fetch,
  brokerApiKey: (env) => env.BROKER_API_KEY,
  browserOrigins: ['http://localhost:5173'],
})

export default {
  fetch(request, env, ctx) {
    return backend.fetch(request, env, ctx)
  },
}
```

Set `authorizeBrowserRequest` before exposing the facade as a production
dashboard. The facade protects the broker credential; it does not define your
application's user/session model.
