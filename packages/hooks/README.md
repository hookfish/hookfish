# `@hookfish/hooks`

Typed React Query hooks and option factories for the Hookfish Hono API.

```tsx
import { createHookfishHooks } from '@hookfish/hooks'

const hookfish = createHookfishHooks({ baseUrl: '/api' })

function RuntimeStats() {
  const stats = hookfish.useStats()
  return <div>{stats.data?.region}</div>
}
```

The same factory exposes query options for loaders, prefetching, and tests:

```ts
await queryClient.prefetchQuery(
  hookfish.options.connections({ provider: 'github' }),
)
```

Path and provider filters compose on the same typed endpoint:

```tsx
const connections = hookfish.useConnections({
  connection_id_prefix: 'team/payments',
  provider: 'github',
})
```

Provider listings also accept registry-specific query fields. They are sent as
strings and included in the React Query cache key, so a registry may implement
offsets, cursors, or custom filters without changing the hooks package:

```tsx
const providers = hookfish.useProviderSearch({
  search: 'notion',
  limit: 50,
  offset: 100,
})
```

Protected routes accept any headers supported by Hono's RPC client. Prefer a
browser-safe session token or cookie. Never put `BROKER_API_KEY` in frontend
code:

```ts
const hookfish = createHookfishHooks({
  baseUrl: '/api',
  headers: async () => ({
    Authorization: `Bearer ${await getSessionToken()}`,
  }),
})
```

Available operations are stats, provider discovery, connection lists and
details, authorization, and disconnect. The OAuth callback remains a browser
navigation target. Access-token retrieval is deliberately server-only and has
no hook.
