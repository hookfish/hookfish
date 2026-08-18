# `@hookfish/backend`

Compatibility entry point for the authenticated client facade. New code should
import from `@hookfish/client`.

Existing `createHookfishBackend` imports continue to work. New Hono
applications can mount `createHookfishClientRoutes` from `@hookfish/client` at
any path with `app.route()`.

- `/api/*` exposes the server-only raw Hookfish API and public OAuth callback.
- `/api/client/*` exposes explicit safe operations only when `config.auth` is
  configured.
- `/api/client/health` reports the selected host runtime after application
  authentication.

```ts
import { createHookfishBackend } from '@hookfish/backend'
import config from './hookfish.config'

const backend = createHookfishBackend({
  config,
  hookfishFetch: rawApiFetch,
  rootApiKey: (env) => env.HOOKFISH_API_KEY,
})

export default {
  fetch(request, env, ctx) {
    return backend.fetch(request, env, ctx)
  },
}
```

The configured application auth provider verifies the user and their current
tenant. The backend signs an ephemeral tenant-scoped capability and strips
application cookies and bearer headers before calling the raw API. It never
returns a broker or provider credential to the client.
