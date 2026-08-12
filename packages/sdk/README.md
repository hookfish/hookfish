# `@hookfish/sdk`

The first-party, end-to-end typed TypeScript client for the Hookfish API.

The low-level request and response types are generated from Hookfish's OpenAPI
contract. The `Hookfish` class provides a stable API that selects global
or organization-prefixed operations from its constructor configuration.

```ts
import { Hookfish } from '@hookfish/sdk'

const hookfish = new Hookfish({
  apiKey: process.env.HOOKFISH_API_KEY,
  baseUrl: 'https://broker.example.com/api',
  organization: 'acme',
})

const { access_token } = await hookfish.oauth.getToken('billing/github')
```

Omit `organization` for global routes. Generated operations and types are also
exported for callers that need direct access to the complete HTTP contract.

## Regenerate

From the monorepo root:

```bash
pnpm --filter @hookfish/sdk generate
```

The command creates the canonical OpenAPI document from `@hookfish/api` and
regenerates the checked-in client source with the pinned Hey API version.
