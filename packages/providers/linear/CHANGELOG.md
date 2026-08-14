# @hookfish/provider-linear

## 0.3.0

### Minor Changes

- 8c7c612: Publish compiled JavaScript instead of TypeScript sources.
  
  Every package now ships `dist` with declarations and source maps, and `exports` resolves there. Node loads them directly — `node app.ts` no longer fails with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, and no `tsx` loader is required to import a Hookfish package.
  
  `@hookfish/api` is the one exception: it serves JavaScript from `dist` but keeps `types` pointing at its sources, because instantiating its full OpenAPI route type from an emitted declaration file exhausts the TypeScript compiler's stack in `@hookfish/hooks`.
  
  `@hookfish/hooks` gains explicit return types on its hooks and option builders, which declaration emit requires. `HookfishHooks` is now written out rather than inferred, and the query option helpers return `UseQueryOptions`/`UseMutationOptions` without TanStack's internal `DataTag` branding.

### Patch Changes

- Updated dependencies [8c7c612]
  - @hookfish/provider@0.6.0

## 0.2.0

### Minor Changes

- ee51ebd: Relicense from MIT to the Functional Source License 1.1 (Apache 2.0 future license) with an attribution requirement for end-user-facing applications. Use, modification, redistribution, and self-hosting stay permitted for every purpose except offering Hookfish as a competing commercial product or service, and each version converts to Apache 2.0 two years after release. `hookfish init` now writes the attribution note into the generated project's `AGENTS.md` and `README.md`. Releases published before this change remain available under MIT.

### Patch Changes

- Updated dependencies [ee51ebd]
  - @hookfish/provider@0.5.0

## 0.1.4

### Patch Changes

- 3602b04: Describe connection providers with OAuth or secret authentication and a small
  input schema, accept generic non-secret connection configuration, and generate
  the updated SDK contract. New projects now include only the generic MCP and
  secret providers by default. Connection configuration and requested OAuth
  scopes are separate inputs; the legacy MCP `url` shorthand and provider
  `configurable` metadata are removed.
- Updated dependencies [3602b04]
  - @hookfish/provider@0.4.0

## 0.1.3

### Patch Changes

- Updated dependencies [796722e]
  - @hookfish/provider@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [397067d]
  - @hookfish/provider@0.2.0

## 0.1.1

### Patch Changes

- Republish packages with resolved workspace dependency versions.

## 0.1.0

### Minor Changes

- 9dafc45: Prepare the initial public release of the Hookfish packages.

### Patch Changes

- Updated dependencies [9dafc45]
  - @hookfish/provider@0.1.0
