---
'@hookfish/api': minor
'@hookfish/sdk': minor
'hookfish': patch
---

Publish the generated first-party TypeScript SDK as `Hookfish`, expose the
broker runtime as `HookfishServer`, add stable OpenAPI operation IDs and a
canonical SDK contract, serve Swagger UI at `/api/docs`, and generate a random
`HOOKFISH_API_KEY` in new CLI projects and as the runtime's root credential.
