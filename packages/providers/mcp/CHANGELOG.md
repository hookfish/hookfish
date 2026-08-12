# @hookfish/provider-mcp

## 0.1.3

### Patch Changes

- Updated dependencies [397067d]
  - @hookfish/provider@0.2.0

## 0.1.2

### Patch Changes

- e62a4cc: Bundle the MCP inspector with the CLI so `npx hookfish inspect` and `npx hookfish inspector` start at `https://inspector.localhost` through Portless, fully stop an existing inspector before taking over its route and PGlite database, and use correct OAuth callbacks. Localhost OAuth clients now use dynamic registration so remote authorization servers can validate the inspector callback. The CLI now requires Node.js 24 or newer to match Portless.

## 0.1.1

### Patch Changes

- Republish packages with resolved workspace dependency versions.

## 0.1.0

### Minor Changes

- 9dafc45: Prepare the initial public release of the Hookfish packages.

### Patch Changes

- Updated dependencies [9dafc45]
  - @hookfish/provider@0.1.0
