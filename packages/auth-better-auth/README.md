# `@hookfish/auth-better-auth`

Use a Better Auth server instance with the organization plugin to authenticate
Hookfish's application-facing API.

```ts
import { createHookfish } from '@hookfish/api'
import { betterAuth } from '@hookfish/auth-better-auth'
import { auth } from './auth'

const hookfish = await createHookfish({
  db,
  providers,
  auth: betterAuth(auth),
})
```

The adapter requires a valid session and verifies membership in the session's
active organization. It never falls back to the user id when an organization is
missing.
