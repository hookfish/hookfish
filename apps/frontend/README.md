# Hookfish frontend host

This private TanStack Start app composes the `@hookfish/client` Hono backend
with the `@hookfish/browser` TanStack Router UI. It connects to a separately
running raw Hookfish server; it does not mount `@hookfish/api`.

The host uses these variables:

| Variable | Purpose |
| --- | --- |
| `HOOKFISH_BACKEND_URL` | Origin of the separate raw Hookfish server |
| `HOOKFISH_API_KEY` | Root key used to mint the session's base-path capability |
| `HOOKFISH_BASE_PATH` | Optional constant base path; defaults to `global` |
| `BETTER_AUTH_SECRET` | Better Auth signing secret; derived locally when omitted |
| `BETTER_AUTH_DATABASE` | Better Auth SQLite file path |
| `HOOKFISH_FRONTEND_URL` | Public frontend origin used by Better Auth and OAuth completion |

`resolveBasePath(session)` in `auth.ts` returns the frontend's canonical
subtree. The bundled implementation returns the constant `HOOKFISH_BASE_PATH`,
defaulting to `global`.
