# Hookfish documentation

External developer documentation for Hookfish, built with Mintlify.

## Development

Install the [Mintlify CLI](https://www.npmjs.com/package/mint):

```bash
npm i -g mint
```

From the repository root, start only the documentation site:

```bash
pnpm run docs
```

View your local preview at `http://localhost:3000`.

## Validate changes

```bash
cd apps/docs
mint broken-links
mint validate
```
