# Building a Smithery-style service with Hookfish

A registry product has two different kinds of data:

- A global catalog of MCP servers that users can discover.
- Connections and encrypted credentials that belong to one organization.

Keep the catalog in the application. Hookfish owns connection state, OAuth
callbacks, encrypted credentials, refresh, revocation, and organization-scoped
persistence.

```text
Application
  Global MCP catalog
  Users and organization membership
  Search, ranking, publishing, and moderation
  Authenticated browser routes

Hookfish
  Trusted mcp provider implementation
  Per-connection MCP URL and scopes
  OAuth state and callbacks
  Encrypted credentials and client registration
  Organization routing and broker authorization
```

## Data model

A catalog table can stay application-specific:

```ts
type CatalogServer = {
  id: string
  name: string
  resourceUrl: string
  scopes: string[]
  status: 'published' | 'disabled'
}
```

Catalog entries never contain user tokens. A dynamic MCP connection uses a path
whose final segment is the trusted `mcp` provider:

```text
catalog/notion/mcp
└── namespace ─┘ └ provider ID
```

With organization routing, Hookfish stores the identity as:

```text
(organization, namespace, providerId)
('acme', 'catalog/notion', 'mcp')
```

The organization is not embedded in the connection path. Treat catalog IDs as
stable path segments. Hide disabled entries from discovery and block new
connections in the application.

## Configure Hookfish once

Register one trusted `mcp` implementation shared by all dynamic catalog
entries:

```ts
import { defineHookfishConfig } from '@hookfish/api'
import { pglite } from '@hookfish/database/pglite'
import { createMcpProvider } from '@hookfish/providers'

export default defineHookfishConfig({
  db: pglite('./pgdata'),
  organizationRouting: true,
  providers: {
    mcp: createMcpProvider(),
  },
})
```

There is no provider-management flag, runtime provider record, template in the
request body, or `/admin/providers` setup step. The first access stores the
catalog server's normalized URL as immutable configuration and tracks OAuth
scopes separately. Reusing the same path with different configuration returns
`409 connection_configuration_conflict`.

Provider IDs are slash-free, non-reserved lower-camel JavaScript identifiers up
to 128 characters. Catalog IDs are namespace segments, so they do not need to
become provider IDs.

## Connect from an authenticated application route

Authenticate the user, verify organization membership, and look up the catalog
entry before calling Hookfish:

```ts
import { Hookfish, HookfishError } from '@hookfish/sdk'

app.onError((error, ctx) => {
  if (
    error instanceof HookfishError &&
    error.code === 'authorization_required'
  ) {
    return ctx.json(
      {
        error: error.code,
        authorize_url: error.authorizeUrl,
        expires_at: error.expiresAt,
      },
      401,
    )
  }
  if (error instanceof HookfishError && error.code === 'scope_not_granted') {
    return ctx.json({ error: error.code }, 403)
  }
  console.error(error)
  return ctx.json({ error: 'Internal server error' }, 500)
})

app.post('/organizations/:organization/servers/:server/connect', async (ctx) => {
  const user = await requireUser(ctx)
  const { organization, server } = ctx.req.param()

  await requireOrganizationMembership(user.id, organization)
  const catalogServer = await registry.get(server)
  if (!catalogServer || catalogServer.status !== 'published') {
    return ctx.json({ error: 'Server not found' }, 404)
  }

  const hookfish = new Hookfish({
    apiKey: await hookfishTokenFor(organization, server),
    baseUrl: `${HOOKFISH_URL}/api`,
    organization,
  })
  const connection = await hookfish.connections.access(
    `catalog/${catalogServer.id}/mcp`,
    {
      configuration: { resource_url: catalogServer.resourceUrl },
      scopes: catalogServer.scopes,
      returnTo: `${APP_URL}/organizations/${organization}/connections`,
    },
  )

  return ctx.json({ connected: true, path: connection.path })
})
```

An unready connection throws Hookfish's direct `authorization_required` error
with a newly generated authorization URL. The route-level error handler returns
that URL to the browser. A ready connection returns its secret to trusted server
code; the route returns metadata instead of exposing the secret. If the
authorization server grants fewer scopes than the catalog entry requires,
Hookfish returns the terminal `scope_not_granted` error instead of restarting
consent. Retry with `connections.authorize()` only after the user changes
provider permissions.

## Call the MCP server

Use the same catalog lookup and connection path when creating the MCP
transport:

```ts
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const mcpUrl = new URL(catalogServer.resourceUrl)
const transport = new StreamableHTTPClientTransport(mcpUrl, {
  authProvider: {
    token: async () =>
      (
        await hookfish.connections.access(
          `catalog/${catalogServer.id}/mcp`,
          {
            configuration: { resource_url: mcpUrl.href },
            scopes: catalogServer.scopes,
            returnTo: `${APP_URL}/organizations/${organization}/connections`,
          },
        )
      ).secret,
    onUnauthorized: async () => {
      await hookfish.connections.authorize(
        `catalog/${catalogServer.id}/mcp`,
        {
          configuration: { resource_url: mcpUrl.href },
          scopes: catalogServer.scopes,
          returnTo: `${APP_URL}/organizations/${organization}/connections`,
        },
      )
    },
  },
})
```

The MCP client gets a usable token before each request. When the upstream server
rejects that token, `onUnauthorized` asks Hookfish to start fresh authorization
and lets the resulting `HookfishError` bubble to the application error handler.

Hookfish discovers the authorization server and then chooses client identity in
this order:

1. Deployment-configured MCP client credentials.
2. The deployment-level HTTPS Client ID Metadata Document when supported.
3. Dynamic Client Registration as a compatibility fallback.

DCR client credentials are encrypted and stored on the individual connection;
they are not reusable provider records.

## Avoid path collisions

The final segment always determines the provider. A fixed Notion provider and a
dynamic Notion catalog entry therefore use different paths:

```text
user/personal/notion       provider ID: notion
user/personal/notion/mcp   provider ID: mcp
```

In the second path, `notion` is an ordinary folder in the namespace. Folder
names may match provider IDs because their position makes the identity
unambiguous.

## Scope broker credentials

Do not expose `HOOKFISH_API_KEY` to the browser. Mint an expiring token for the
connection or catalog subtree:

```json
{
  "name": "acme-catalog-worker",
  "scopes": ["catalog/**"],
  "expires_in": 3600
}
```

Broker resource scopes apply to connection paths. Organization routing selects
the storage context separately; it does not add the organization to a resource
scope. The application must ensure that a token intended for Acme is used only
after Acme membership has been verified.

## Database partitioning

A shared Postgres database stores the organization as a row key. On Cloudflare,
map each organization to a Durable Object and reserve a global object for
broker-token authentication:

```ts
const db = durableObjects<Env>((bindings, context) =>
  bindings.HOOKFISH_DB.getByName(
    context.organization
      ? `organization:${context.organization}`
      : '__global__',
  ),
)
```

Callbacks recover the organization from authenticated OAuth state before
selecting the organization database. The callback and deployment client
metadata URLs remain global:

```text
/api/connections/callback/mcp
/api/connections/client-metadata.json
```

## Large trusted provider catalogs

`createProviderSource()` remains available when the catalog itself contains
many trusted OAuth provider implementations. It lazily resolves provider code
by provider ID. It is not needed for a catalog of arbitrary remote MCP servers:
use the single `mcp` provider and connection-local configuration for that case.

## Frontend organization views

The bundled dashboard does not select an organization context. A
Smithery-style product should expose an application route such as:

```text
/organizations/acme/connections
```

That page calls the application's authenticated endpoint. The application
verifies membership and uses an organization-configured `Hookfish` SDK client
server-side. Supporting organization selection directly in the bundled
dashboard would require organization-aware frontend routes, query keys, and
browser-facade authorization.
