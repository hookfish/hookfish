import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory)
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const pathname = path.join(directory, entry)
      return (await stat(pathname)).isDirectory() ? files(pathname) : [pathname]
    }),
  )
  return nested.flat()
}

describe('browser credential regression', () => {
  it('contains no Hookfish broker-token storage or raw credential routes', async () => {
    const sourceRoot = path.resolve(import.meta.dirname, '..')
    const thisFile = path.resolve(import.meta.filename)
    const serverEntry = path.join(sourceRoot, 'server.ts')
    const source = (
      await Promise.all(
        (
          await files(sourceRoot)
        )
          .filter(
            (pathname) =>
              pathname !== thisFile &&
              pathname !== serverEntry &&
              ['.css', '.ts', '.tsx'].includes(path.extname(pathname)),
          )
          .map((pathname) => readFile(pathname, 'utf8')),
      )
    ).join('\n')
    const forbidden = [
      ['hookfish', 'management-token'].join('.'),
      ['HOOKFISH', 'API', 'KEY'].join('_'),
      ['connections', 'access'].join('/'),
      ['', 'api', 'admin', 'tokens'].join('/'),
    ]
    for (const value of forbidden) expect(source).not.toContain(value)
  })
})
