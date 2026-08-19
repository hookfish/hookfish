# Hookfish connections

Hookfish stores OAuth tokens and static credentials behind one structured
connection path. Trusted server code calls `connections.access(path)` and
receives either a usable `secret` or `authorization_required` with a fresh URL.

## Identity

A path ends with a trusted provider implementation. Concrete providers can
follow an optional namespace. Generic providers use a resource identity before
the final provider segment.

```text
user/personal/gmail       concrete Gmail provider
user/personal/gmail/mcp   namespace=user/personal, identity=gmail, providerId=mcp
service/prod/openai/secret
```

Provider IDs are slash-free, non-reserved lower-camel JavaScript identifiers.
The database enforces one row per `(namespace, providerId)`. Multi-tenant
applications put the tenant identifier in the namespace, such as
`organizations/acme/user/personal`.

## SDK

```ts
const mcpUrl = new URL('https://gmail.run.tools')
const connection = {
  path: 'user/personal/gmail/mcp',
  input: { configuration: { resource_url: mcpUrl.href } },
}
const authProvider = {
  token: async () =>
    (await hookfish.connections.access(connection.path, connection.input))
      .secret,
  onUnauthorized: async () => {
    await hookfish.connections.authorize(connection.path, connection.input)
  },
}
```

When OAuth is required, the SDK throws `HookfishError` with code
`authorization_required`, plus `authorizeUrl` and `expiresAt`. Each unready
access creates a fresh URL and supersedes older pending state. For MCP, use
the client's `onUnauthorized` callback to call `connections.authorize()`. The
direct Hookfish error then bubbles to your application error handler.

Hookfish persists requested provider scopes separately from the scopes returned
by the token endpoint. Access requests for scopes that were never requested
start authorization; scopes requested but not granted return the terminal
`scope_not_granted` error. Call `connections.authorize()` explicitly to retry
after the user changes provider permissions.

For static credentials, register `createSecretProvider()` and call:

```ts
await hookfish.connections.setSecret(
  'service/prod/openai/secret',
  'sk-example',
)
const { secret } = await hookfish.connections.access(
  'service/prod/openai/secret',
)
```

## HTTP routes

| Method | Path |
| --- | --- |
| `POST` | `/api/connections/access/{connection_path}` |
| `POST` | `/api/connections/authorize/{connection_path}` |
| `PUT` | `/api/connections/secret/{connection_path}` |
| `GET` | `/api/connections` |
| `GET` | `/api/connections/entry/{connection_path}` |
| `DELETE` | `/api/connections/entry/{connection_path}` |
| `GET` | `/api/connections/providers` |
| `GET` | `/api/connections/callback/{provider_id}` |
| `GET` | `/api/connections/client-metadata.json` |
| `GET` | `/api/access` |

Callbacks and client metadata are public. Other connection routes require the
root key or a scoped broker token. Exact path scopes and `namespace/**` scopes
are distinct. `/api/access` returns safe metadata describing the presented
root or scoped grant; it never returns the token.

## MCP client registration

MCP is the resource protocol, not an authentication kind. The trusted `mcp`
provider acquires OAuth credentials, stores the MCP URL as immutable
configuration, and tracks requested and granted scopes separately. It discovers
OAuth metadata, requires PKCE S256, prefers the deployment HTTPS Client ID
Metadata Document, and uses Dynamic Client Registration only as a fallback. DCR
credentials are encrypted and owned by that connection.

## Security

Access and secret writes are server-only. Successful access responses, refresh
tokens, OAuth client secrets, and stored static values never appear in
connection metadata or the separate `@hookfish/client` Hono app.
