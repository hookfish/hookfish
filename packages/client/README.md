# `@hookfish/client`

Authenticated, tenant-isolated Hookfish routes for a Hono application.

```ts
import { HookfishServer } from '@hookfish/api'
import { betterAuth } from '@hookfish/auth-better-auth'
import { createHookfishClientRoutes } from '@hookfish/client'
import { Hono } from 'hono'

const hookfish = await HookfishServer.init(config)
const client = createHookfishClientRoutes({
  auth: betterAuth(auth),
  hookfishFetch: hookfish.fetch,
})

const app = new Hono()
  .route('/api/client', client)
  .route('/', hookfish)
```

The package exposes only connection-management operations. It authenticates
every request, scopes paths to the verified tenant, and never returns broker or
provider credentials to the browser.
