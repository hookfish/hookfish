---
'@hookfish/api': patch
'@hookfish/sdk': patch
---

Fix three type errors that only surfaced in consumer builds, since both packages ship TypeScript sources.

- `@hookfish/api`: pin the `authentication` literals in `GET /connections/providers` so inference cannot widen them to `string`, and stop annotating two internal helpers with `CryptoKey`, which is only ambient under the DOM lib.
- `@hookfish/sdk`: `connections.*`, `accessTokens.*` and `stats()` declared a `{ data, request, response }` envelope while resolving the bare response body. They now resolve and declare the body. Callers who worked around this by reading `.data` must read the body directly.
- `@hookfish/sdk`: the generated client no longer references `BodyInit`, so it compiles under a Node-only `lib`.
