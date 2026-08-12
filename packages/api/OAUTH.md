# Hookfish connections

Hookfish stores OAuth tokens and static credentials behind one structured
connection path. Trusted server code calls `connections.access(path)` and
receives either a usable `secret` or `authorization_required` with a fresh URL.

## Identity

A path is `namespace/providerId`. The final segment selects trusted provider
code; the preceding segments form the namespace.

```text
user/personal/gmail       namespace=user/personal, providerId=gmail
user/personal/gmail/mcp   namespace=user/personal/gmail, providerId=mcp
service/prod/openai/secret
```

Provider IDs are slash-free, non-reserved lower-camel JavaScript identifiers.
The database enforces one row per `(organization, namespace, providerId)`.

## SDK

```ts
const mcpUrl = new URL('https://gmail.run.tools')
const authProvider = hookfish.connections.mcpAuthProvider(
  'user/personal/gmail/mcp',
  { url: mcpUrl.href, scopes: [] },
)
```

When OAuth is required, the SDK throws `HookfishError` with code
`authorization_required`, plus `authorizeUrl` and `expiresAt`. Each unready
access creates a fresh URL and supersedes older pending state. For MCP, use
`connections.mcpAuthProvider()` so an upstream `401` starts fresh authorization
and lets the direct Hookfish error bubble to your application error handler.

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
| `POST` | `/api/connections/reauthorize/{connection_path}` |
| `PUT` | `/api/connections/secret/{connection_path}` |
| `GET` | `/api/connections` |
| `GET` | `/api/connections/entry/{connection_path}` |
| `DELETE` | `/api/connections/entry/{connection_path}` |
| `GET` | `/api/connections/providers` |
| `GET` | `/api/connections/callback/{provider_id}` |
| `GET` | `/api/connections/client-metadata.json` |

Callbacks and client metadata are public. Other connection routes require the
root key or a scoped broker token. Exact path scopes and `namespace/**` scopes
are distinct.

## MCP client registration

The trusted `mcp` provider stores the MCP URL and scopes on the connection. It
discovers OAuth metadata, requires PKCE S256, prefers the deployment HTTPS
Client ID Metadata Document, and uses Dynamic Client Registration only as a
fallback. DCR credentials are encrypted and owned by that connection.

## Security

Access and secret writes are server-only. Successful access responses, refresh
tokens, OAuth client secrets, and stored static values never appear in
connection metadata or the browser-safe facade.
