# `@hookfish/backend`

Fetch-compatible composition layer for a Hookfish deployment.

`Hookfish.init(...).fetch` applies this composition automatically. Import this
lower-level package only when composing a raw Hookfish-compatible API handler
yourself.

- `/api/*` exposes the raw Hookfish API and OAuth callback surface.
- `/api/client/*` is a browser-safe facade that forwards an allowlisted subset to
  Hookfish with a server-side broker credential.
- `/api/client/health` reports the selected host runtime.

```ts
import { createHookfishBackend } from '@hookfish/backend'
import config from './hookfish.config'

const backend = createHookfishBackend({
  config,
  hookfishFetch: rawApiFetch,
  brokerApiKey: (env) => env.BROKER_API_KEY,
})

export default {
  fetch(request, env, ctx) {
    return backend.fetch(request, env, ctx)
  },
}
```

Set `authorizeBrowserRequest` before exposing the facade as a production
dashboard. The facade protects the broker credential; it does not define your
application's user/session model. `config.includeClient` controls whether the
facade is mounted, and `config.trustedOrigins` supplies its cross-origin
allowlist unless `browserOrigins` is explicitly overridden.
