import { readFile, writeFile } from 'node:fs/promises'

/**
 * `openapi-ts` emits `BodyInit`, which only exists as an ambient type under the
 * DOM lib. Consumers compiling these sources with a Node-only lib cannot resolve
 * it, so rewrite it to an equivalent that both libs declare. Runs after every
 * generation; `pnpm typecheck` fails if it is ever skipped.
 */
const client = new URL('../src/generated/client/client.gen.ts', import.meta.url)
const source = await readFile(client, 'utf8')
const patched = source.replaceAll(
  'as BodyInit | null | undefined',
  "as RequestInit['body']",
)

if (patched !== source) await writeFile(client, patched)
