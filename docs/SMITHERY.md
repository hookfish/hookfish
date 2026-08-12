# Building a Smithery-style service with Hookfish

A registry product has two different kinds of data:

- A global catalog of MCP servers that users can discover.
- OAuth connections and secrets that belong to one organization.

Keep those concerns separate. The application owns the catalog, users, and
organization membership. Hookfish owns OAuth, encrypted credentials, token
refresh, callbacks, and organization-scoped persistence.

```text
Application
  Global server catalog
  Users and organization membership
  Search, ranking, publishing, and moderation
  Browser routes and authorization

Hookfish
  Provider resolution
  OAuth state and callbacks
  Organization provider installations
  Organization connections and secrets
  Token encryption, refresh, and revocation
```

## Data model

A small catalog table is enough to start:

```ts
type CatalogServer = {
  id: string
  name: string
  resourceUrl: string
  scopes: string[]
  status: 'published' | 'disabled'
}
```

Catalog entries do not contain user tokens. A Hookfish connection references
the stable catalog ID and stores its organization separately:

```ts
{
  organization: 'acme',
  provider: 'notion',
  connectionId: 'acme/notion/finance'
}
```

Treat catalog IDs as immutable. Hide disabled servers from listings and block
new connections in the application, but keep them resolvable until existing
connections no longer need their configuration for refresh or revocation.

## Configure a lazy global registry

Hookfish should not load the entire catalog during every OAuth operation.
Configure a provider source so authorization, callback, refresh, and revocation
resolve only one provider by ID:

```ts
import {
  defineHookfishConfig,
  createProviderSource,
} from '@hookfish/api'
import { pglite } from '@hookfish/database/pglite'
import { createMcpProvider } from '@hookfish/provider-mcp'

type Env = {
  REGISTRY: {
    get(id: string): Promise<CatalogServer | undefined>
    list(input: {
      search?: string
      limit?: number
      offset?: number
    }): Promise<{ items: CatalogServer[]; total: number }>
  }
}

function providerFor(server: CatalogServer) {
  return createMcpProvider({
    resourceUrl: server.resourceUrl,
    scopes: server.scopes,
  })
}

export default defineHookfishConfig<Env>({
  db: pglite('./pgdata'),
  organizationRouting: true,
  providerManagement: true,
  providers: createProviderSource<Env>({
    async getProvider(id, env) {
      const server = await env.REGISTRY.get(id)
      return server ? providerFor(server) : undefined
    },

    async listProviders(query, env) {
      const search = query.get('search') ?? undefined
      const limit = Number(query.get('limit') ?? 50)
      const offset = Number(query.get('offset') ?? 0)
      const page = await env.REGISTRY.list({ search, limit, offset })

      return {
        providers: page.items.map((server) => ({
          id: server.id,
          provider: providerFor(server),
        })),
        total: page.total,
        limit,
        offset,
      }
    },
  }),
})
```

`listProviders` is optional and flexible. A registry may:

- Ignore the query and return every provider.
- Accept `limit` and `offset`.
- Accept a cursor and return `next_cursor`.
- Add search, category, sort, or other query parameters.

Only the `providers` array has a fixed meaning. Hookfish passes other response
fields through to the caller. Normal OAuth operations use `getProvider` and do
not invoke the listing callback.

## Keep connections organization-scoped

The application should expose its own authenticated browser endpoint. It
validates membership and then makes a server-to-server Hookfish request:

```ts
app.post('/organizations/:organization/servers/:server/connect', async (c) => {
  const user = await requireUser(c)
  const { organization, server } = c.req.param()

  await requireOrganizationMembership(user.id, organization)
  const catalogServer = await registry.get(server)
  if (!catalogServer || catalogServer.status !== 'published') {
    return c.json({ error: 'Server not found' }, 404)
  }

  const response = await fetch(
    `${HOOKFISH_URL}/api/organization/${encodeURIComponent(organization)}` +
      `/oauth/authorize/${encodeURIComponent(server)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await hookfishTokenFor(organization, server)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        connection_id_prefix: `${organization}/${server}`,
        return_to:
          `${APP_URL}/organizations/${organization}/connections`,
      }),
    },
  )

  return c.json(await response.json(), response.status)
})
```

The browser navigates to the returned `authorize_url`. Hookfish carries the
organization in authenticated OAuth state, receives the global callback, and
selects the same organization partition before storing the connection.

List connections through the same application boundary:

```ts
app.get('/organizations/:organization/connections', async (c) => {
  const user = await requireUser(c)
  const { organization } = c.req.param()

  await requireOrganizationMembership(user.id, organization)

  const response = await fetch(
    `${HOOKFISH_URL}/api/organization/${encodeURIComponent(organization)}` +
      '/oauth/connections',
    {
      headers: {
        Authorization: `Bearer ${await hookfishTokenFor(organization)}`,
      },
    },
  )

  return c.json(await response.json(), response.status)
})
```

Do not expose the root `HOOKFISH_API_KEY` to the browser. Use a server-held root
credential or mint scoped Hookfish credentials. A scoped credential that uses
a global provider currently needs access to both the organization namespace
and provider ID, for example `['acme/**', 'notion']`.

## Shared versus organization-specific OAuth clients

For a shared platform OAuth client, return the catalog provider directly from
`getProvider`. Every organization uses the same OAuth application, while each
connection remains organization-scoped.

If every organization needs its own OAuth client or dynamic client
registration, keep the catalog metadata global but create an organization
provider installation first:

```ts
const providerId = `${organization}/${server.id}`

await fetch(
  `${HOOKFISH_URL}/api/organization/${organization}` +
    `/admin/providers/${providerId}`,
  {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${organizationToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      template: 'mcp',
      label: server.name,
      configuration: {
        resource_url: server.resourceUrl,
        scopes: server.scopes,
      },
      credentials: { mode: 'register' },
    }),
  },
)
```

Authorize against `acme/notion` instead of the global `notion` entry. Hookfish
then keeps the provider credentials and connections inside Acme's partition.

## Database partitioning

A shared Postgres database can use Hookfish's organization columns. On
Cloudflare, map each organization to a Durable Object and reserve one global
object for broker credentials:

```ts
const db = durableObjects<Env>((env, context) =>
  env.HOOKFISH_DB.getByName(
    context.organization
      ? `organization:${context.organization}`
      : '__global__',
  ),
)
```

The global partition is part of the control plane. Organization partitions
hold OAuth state, connections, dynamic providers, and secrets.

## Frontend organization views

The bundled Hookfish dashboard does not currently have an organization picker
or organization route. It always calls the global `/api/client/oauth/...`,
`/api/admin/providers`, and `/api/secrets` endpoints. Enabling
`organizationRouting` therefore does not make `/connections/acme` an
organization view; that path is interpreted as a connection folder.

A Smithery-style product should use an application route such as:

```text
/organizations/acme/connections
```

That page should call the application's authenticated endpoint shown above.
The application verifies membership and calls Hookfish's organization route
server-to-server. Supporting organizations directly in the bundled dashboard
would require organization-aware frontend routes and query keys, organization
paths in the management client, and browser-facade support for allowlisted
`/api/organization/:organization/oauth/...` operations.
