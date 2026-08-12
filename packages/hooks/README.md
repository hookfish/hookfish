# `@hookfish/hooks`

Typed React Query hooks for Hookfish metadata routes.

```tsx
const hookfish = createHookfishHooks({ baseUrl: '/api/client' })

function Connections() {
  const query = hookfish.useConnections({
    namespace: 'user/personal',
    provider_id: 'github',
  })
  return query.data?.connections.map((connection) => (
    <div key={connection.path}>{connection.path}</div>
  ))
}
```

The package exposes stats, trusted-provider listings, connection metadata, and
disconnect. It intentionally has no connection-access or secret-write hook:
successful access returns a usable credential and must remain in trusted server
code.
