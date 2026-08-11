# @hookfish/api

## 0.2.0

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

## 0.1.1

### Patch Changes

- Republish packages with resolved workspace dependency versions.

## 0.1.0

### Minor Changes

- 9dafc45: Prepare the initial public release of the Hookfish packages.

### Patch Changes

- Updated dependencies [9dafc45]
  - @hookfish/provider@0.1.0
