import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * `openapi-ts` emits `BodyInit`, which only exists as an ambient type under the
 * DOM lib. Consumers compiling these sources with a Node-only lib cannot resolve
 * it, so rewrite it to an equivalent that both libs declare. Runs after every
 * generation; `pnpm typecheck` fails if it is ever skipped.
 */
const generated = new URL('../src/generated/', import.meta.url)

async function generatedFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: URL[] = []
  for (const entry of entries) {
    const location = new URL(entry.name, directory)
    if (entry.isDirectory()) {
      files.push(
        ...(await generatedFiles(new URL(`${entry.name}/`, directory))),
      )
    } else if (entry.name.endsWith('.ts')) {
      files.push(location)
    }
  }
  return files
}

async function exists(location: string): Promise<boolean> {
  return stat(location).then(
    () => true,
    () => false,
  )
}

for (const file of await generatedFiles(generated)) {
  const source = await readFile(file, 'utf8')
  let patched = source.replaceAll(
    'as BodyInit | null | undefined',
    "as RequestInit['body']",
  )
  const specifiers = [...patched.matchAll(/(['"])(\.\.?\/[^'"]+)\1/g)].map(
    (match) => match[2],
  )
  for (const specifier of new Set(specifiers)) {
    if (!specifier || /\.(?:[cm]?[jt]sx?|json|css)$/.test(specifier)) continue
    const resolved = path.resolve(path.dirname(file.pathname), specifier)
    const replacement = (await exists(`${resolved}.ts`))
      ? `${specifier}.js`
      : (await exists(path.join(resolved, 'index.ts')))
        ? `${specifier}/index.js`
        : undefined
    if (replacement) {
      patched = patched
        .replaceAll(`'${specifier}'`, `'${replacement}'`)
        .replaceAll(`"${specifier}"`, `"${replacement}"`)
    }
  }

  if (patched !== source) await writeFile(file, patched)
}
