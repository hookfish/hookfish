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

The package exposes provider listings, connection metadata, and disconnect.
The application API also offers explicit authorize and write-only secret
endpoints for setup. It intentionally has no connection-access operation:
usable credentials remain in trusted server code.
