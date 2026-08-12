# hookfish

## 0.8.4

### Patch Changes

- 351638f: Remove the generated `hookfish.project.json` marker and make `hookfish dev` and
  `hookfish serve` consistently serve the packaged dashboard with an API proxy.
  Serving now requires an explicit `--backend-url` or `HOOKFISH_BACKEND_URL`.
- @hookfish/database@0.2.1

## 0.8.3

### Patch Changes

- 24c9d86: Fix Cloudflare scaffold dashboard requests by keeping the frontend origin consistent and removing stale compression headers from proxied Wrangler responses.

## 0.8.2

### Patch Changes

- 6beca47: Run the inspector directly on localhost and remove the Portless dependency so
  it no longer installs certificates, modifies the hosts file, or requires sudo.

## 0.8.1

### Patch Changes

- 120c06f: Keep generated projects on the CLI's prerelease channel and preapprove the
  required esbuild install script for pnpm.

## 0.8.0

### Minor Changes

- ecb9904: Add `hookfish init` scaffolds for Vercel, Cloudflare Durable Objects, Node.js,
  Bun, and Docker, plus a standalone `hookfish serve` development dashboard that
  accepts `--backend-url`. Generated `dev:server` scripts run their platform-native
  development server, while `dev` composes that server with the Hookfish dashboard.
  The dashboard proxy preserves OAuth callback redirects so the browser returns to
  the frontend route after authorization. Dashboard authorization stays in the
  same tab so its session-scoped broker credential survives the OAuth round trip.
  Scaffolds generate a gitignored local environment with an encryption key, and
  native Node development loads that file before starting the broker.
  Publish the generic database contract and Durable Object adapter used by the
  Cloudflare scaffold.
- e62a4cc: Bundle the MCP inspector with the CLI so `npx hookfish inspect` and `npx hookfish inspector` start at `https://inspector.localhost` through Portless, fully stop an existing inspector before taking over its route and PGlite database, and use correct OAuth callbacks. Localhost OAuth clients now use dynamic registration so remote authorization servers can validate the inspector callback. The CLI now requires Node.js 24 or newer to match Portless.

### Patch Changes

- Updated dependencies [ecb9904]
  - @hookfish/database@0.2.0

## 0.7.1

### Patch Changes

- Republish packages with resolved workspace dependency versions.
- Updated dependencies
  - @hookfish/database@0.1.1

## 0.7.0

### Minor Changes

- 9dafc45: Prepare the initial public release of the Hookfish packages.

### Patch Changes

- Updated dependencies [9dafc45]
  - @hookfish/database@0.1.0
