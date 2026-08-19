# Hookfish BFF

The product frontend talks only to this Node server. It mounts Better Auth at
`/api/auth` and the authenticated, tenant-isolated `@hookfish/client` routes at
`/api/client`. It deliberately does not expose the raw Hookfish API.

The BFF authenticates the current user and active organization, signs a
short-lived tenant capability, and forwards the resulting server-to-server
request to `HOOKFISH_BACKEND_URL`.

Required environment variables:

- `BETTER_AUTH_SECRET` — at least 32 random characters.
- `HOOKFISH_API_KEY` — the same root key used by the Hookfish backend.

Local development defaults to a SQLite auth database at
`.data/better-auth.sqlite`. Set `BETTER_AUTH_DATABASE_PATH` to move it.
