import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

async function files(directory) {
  const entries = await readdir(directory)
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const pathname = path.join(directory, entry)
      return (await stat(pathname)).isDirectory() ? files(pathname) : [pathname]
    }),
  )
  return nested.flat()
}

const directory = path.resolve(process.argv[2] ?? 'dist/client')
const output = (
  await Promise.all(
    (await files(directory)).map((file) => readFile(file, 'utf8')),
  )
).join('\n')
const forbidden = [
  ['hookfish', 'management-token'].join('.'),
  ['HOOKFISH', 'API', 'KEY'].join('_'),
  ['connections', 'access'].join('/'),
  ['', 'api', 'admin', 'tokens'].join('/'),
]

for (const value of forbidden) {
  if (output.includes(value)) {
    throw new Error(
      `Browser bundle contains forbidden credential surface: ${value}`,
    )
  }
}
