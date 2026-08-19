# `@hookfish/browser`

The Hookfish connection-management interface as an embeddable TanStack Router
application. It calls a browser-safe Hono facade and never receives a Hookfish
API key.

Import `@hookfish/browser/router` for `getRouter` and
`@hookfish/browser/style.css` for the generated stylesheet.

## Embed in React or Next.js

Import the client component and mount it beneath a catch-all route:

```tsx
import { HookfishBrowser } from '@hookfish/browser/react'
import '@hookfish/browser/style.css'

export function Integrations() {
  return (
    <HookfishBrowser
      basepath="/settings/integrations"
      clientApiUrl="/api/client"
      signInUrl="/login"
    />
  )
}
```

The host must serve every URL below `basepath` through the component and mount
an authenticated `@hookfish/client` app at `clientApiUrl`.
