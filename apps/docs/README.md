# Hookfish documentation

This directory contains the external developer documentation for Hookfish. The
site uses Mintlify, with navigation and site settings in `docs.json` and content
in MDX files.

## Preview the site

Install the [Mintlify CLI](https://www.npmjs.com/package/mint), then start the
preview from the repository root.

```bash
npm install --global mint
pnpm run docs
```

The preview runs at `http://localhost:3000` by default.

## Validate changes

Run the checks from this directory so Mintlify resolves the local `docs.json`.

```bash
cd apps/docs
mint validate
mint broken-links
mint a11y
```

Public pages document published packages and generated projects. Keep monorepo
development commands in the root `README.md`.
