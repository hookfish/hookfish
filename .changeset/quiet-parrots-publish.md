---
'@hookfish/provider-github': minor
'@hookfish/provider-linear': minor
'@hookfish/provider-notion': minor
'@hookfish/provider-mcp': minor
'@hookfish/providers': minor
'@hookfish/provider': minor
'@hookfish/database': minor
'@hookfish/backend': minor
'@hookfish/hooks': minor
'@hookfish/api': minor
'@hookfish/sdk': minor
---

Publish compiled JavaScript instead of TypeScript sources.

Every package now ships `dist` with declarations and source maps, and `exports` resolves there. Node loads them directly — `node app.ts` no longer fails with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, and no `tsx` loader is required to import a Hookfish package.

`@hookfish/api` is the one exception: it serves JavaScript from `dist` but keeps `types` pointing at its sources, because instantiating its full OpenAPI route type from an emitted declaration file exhausts the TypeScript compiler's stack in `@hookfish/hooks`.

`@hookfish/hooks` gains explicit return types on its hooks and option builders, which declaration emit requires. `HookfishHooks` is now written out rather than inferred, and the query option helpers return `UseQueryOptions`/`UseMutationOptions` without TanStack's internal `DataTag` branding.
