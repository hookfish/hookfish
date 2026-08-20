# `@hookfish/backend`

Fetch-compatible composition layer for a Hookfish deployment.

It also exports `HookfishBackend`, the OAuth-only managed-backend contract used
by `createHookfish({ backend })`. A managed service such as Arcade implements
the adapter and remains responsible for OAuth state, token storage, refresh,
and revocation. Hookfish remains responsible for application authentication,
tenant isolation, and its HTTP/SDK surface.

```ts
import { createHookfish } from '@hookfish/api'
import { HookfishBackend } from '@hookfish/backend'

const hookfish = await createHookfish({
  auth,
  backend: new HookfishBackend(arcadeAdapter),
})
```

The managed adapter exposes OAuth providers and connections only. There is no
static-secret write method in `HookfishBackendAdapter`; requests to store one
return `static_secrets_unsupported`. Database-backed broker-token
administration is also not mounted in managed mode.

`createHookfish(...).fetch` and `HookfishServer.init(...).fetch` apply this
composition automatically. Import the lower-level package only when composing
a raw Hookfish-compatible handler yourself.

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
