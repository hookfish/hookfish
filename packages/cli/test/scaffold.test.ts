import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  dependencyTagForVersion,
  type ScaffoldBackend,
  scaffoldBackends,
  scaffoldProject,
} from '../src/scaffold'

const directories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'hookfish-init-'))
  directories.push(directory)
  return directory
}

function packageFile(directory: string): {
  scripts: Record<string, string>
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
} {
  return JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('scaffoldProject', () => {
  it('uses the prerelease channel for prerelease CLI versions', () => {
    expect(dependencyTagForVersion('0.8.0-canary-62cbef6')).toBe('canary')
    expect(dependencyTagForVersion('0.8.0-beta.2')).toBe('beta')
    expect(dependencyTagForVersion('0.8.0')).toBe('latest')
  })

  it.each(
    scaffoldBackends,
  )('creates a %s project that runs hookfish serve', (backend) => {
    const parentDirectory = temporaryDirectory()
    const result = scaffoldProject({
      name: `broker-${backend}`,
      backend,
      parentDirectory,
    })
    const packageJson = packageFile(result.directory)

    expect(
      existsSync(path.join(result.directory, 'hookfish.project.json')),
    ).toBe(false)
    expect(packageJson.scripts.dev).toContain('npm:dev:server')
    expect(packageJson.scripts.dev).toContain('hookfish serve --backend-url')
    expect(packageJson.scripts['dev:server']).toBeTruthy()
    expect(packageJson.scripts['dev:server']).not.toContain('hookfish serve')
    expect(packageJson.dependencies['@hookfish/api']).toBe('latest')
    expect(
      readFileSync(path.join(result.directory, 'pnpm-workspace.yaml'), 'utf8'),
    ).toContain('esbuild: true')
    expect(
      readFileSync(path.join(result.directory, 'README.md'), 'utf8'),
    ).toContain(`**${backend}**`)
    if (backend === 'vercel') {
      expect(packageJson.scripts['dev:server']).toContain('vercel dev')
    }
    if (backend === 'bun') {
      expect(
        JSON.parse(
          readFileSync(path.join(result.directory, 'tsconfig.json'), 'utf8'),
        ).compilerOptions.types,
      ).toContain('bun')
    }
    const environmentFile = backend === 'cloudflare' ? '.dev.vars' : '.env'
    const environment = readFileSync(
      path.join(result.directory, environmentFile),
      'utf8',
    )
    const encryptionKey = environment.match(
      /^OAUTH_ENCRYPTION_KEY=(.+)$/m,
    )?.[1]
    const brokerApiKey = environment.match(/^HOOKFISH_API_KEY=(.+)$/m)?.[1]

    expect(encryptionKey).toMatch(/^[A-Za-z0-9+/]{43}=$/)
    expect(brokerApiKey).toMatch(/^[A-Za-z0-9+/]{43}=$/)
    expect(brokerApiKey).not.toBe(encryptionKey)
    expect(brokerApiKey).not.toBe('test')
  })

  it('generates a distinct broker API key for each project', () => {
    const parentDirectory = temporaryDirectory()
    const first = scaffoldProject({
      name: 'broker-one',
      backend: 'node',
      parentDirectory,
    })
    const second = scaffoldProject({
      name: 'broker-two',
      backend: 'node',
      parentDirectory,
    })
    const brokerKey = (directory: string) =>
      readFileSync(path.join(directory, '.env'), 'utf8').match(
        /^HOOKFISH_API_KEY=(.+)$/m,
      )?.[1]

    expect(brokerKey(first.directory)).not.toBe(brokerKey(second.directory))
  })

  it('keeps all Hookfish dependencies on the requested release channel', () => {
    const parentDirectory = temporaryDirectory()
    const { directory } = scaffoldProject({
      name: 'broker-canary',
      backend: 'node',
      dependencyTag: 'canary',
      parentDirectory,
    })
    const packageJson = packageFile(directory)

    expect(packageJson.dependencies['@hookfish/api']).toBe('canary')
    expect(packageJson.dependencies['@hookfish/database']).toBe('canary')
    expect(packageJson.dependencies['@hookfish/providers']).toBe('canary')
    expect(packageJson.devDependencies.hookfish).toBe('canary')
  })

  it('loads the generated environment in the native Node server', () => {
    const parentDirectory = temporaryDirectory()
    const { directory } = scaffoldProject({
      name: 'broker-node-env',
      backend: 'node',
      parentDirectory,
    })

    expect(packageFile(directory).scripts['dev:server']).toContain(
      'node --env-file=.env --watch',
    )
  })

  it('uses a declarative SQLite Durable Object export for Cloudflare', () => {
    const parentDirectory = temporaryDirectory()
    const { directory } = scaffoldProject({
      name: 'broker-cloudflare',
      backend: 'cloudflare',
      parentDirectory,
    })
    const config = JSON.parse(
      readFileSync(path.join(directory, 'wrangler.jsonc'), 'utf8'),
    )

    expect(config.exports.HookfishDurableObject).toEqual({
      type: 'durable-object',
      storage: 'sqlite',
    })
    expect(config.migrations).toBeUndefined()
    expect(packageFile(directory).scripts['dev:server']).toContain(
      '--var HOOKFISH_FRONTEND_URL:',
    )
  })

  it('adds the deployment-specific files', () => {
    const expected: Record<ScaffoldBackend, string> = {
      vercel: 'src/index.ts',
      cloudflare: 'wrangler.jsonc',
      node: 'hookfish.config.ts',
      bun: 'src/index.ts',
      docker: 'compose.yaml',
    }

    for (const backend of scaffoldBackends) {
      const parentDirectory = temporaryDirectory()
      const result = scaffoldProject({
        name: `files-${backend}`,
        backend,
        parentDirectory,
      })
      expect(result.files).toContain(expected[backend])
    }
  })

  it.each([
    'node',
    'bun',
    'docker',
  ] as const)('creates the parent directory for a filesystem-backed PGlite database on %s', (backend) => {
    const parentDirectory = temporaryDirectory()
    const { directory } = scaffoldProject({
      name: `broker-${backend}`,
      backend,
      parentDirectory,
    })
    const config = readFileSync(
      path.join(directory, 'hookfish.config.ts'),
      'utf8',
    )

    expect(config).toContain("import { mkdirSync } from 'node:fs'")
    expect(config).toContain(
      'mkdirSync(path.dirname(path.resolve(dataDir)), { recursive: true })',
    )
    expect(config).toContain('db: pglite(dataDir)')
  })

  it('only prepares the local PGlite directory on Vercel without DATABASE_URL', () => {
    const parentDirectory = temporaryDirectory()
    const { directory } = scaffoldProject({
      name: 'broker-vercel',
      backend: 'vercel',
      parentDirectory,
    })
    const config = readFileSync(
      path.join(directory, 'hookfish.config.ts'),
      'utf8',
    )

    expect(config).toContain("import { mkdirSync } from 'node:fs'")
    expect(config).toContain('if (!databaseUrl &&')
    expect(config).toContain(
      'mkdirSync(path.dirname(path.resolve(dataDir)), { recursive: true })',
    )
    expect(config).toContain(': pglite(dataDir)')
  })

  it('refuses invalid names and non-empty target directories', () => {
    const parentDirectory = temporaryDirectory()
    expect(() =>
      scaffoldProject({
        name: 'Invalid Name',
        backend: 'node',
        parentDirectory,
      }),
    ).toThrow('Project name')

    const occupied = path.join(parentDirectory, 'occupied')
    mkdirSync(occupied)
    writeFileSync(path.join(occupied, 'keep.txt'), 'keep')
    expect(() =>
      scaffoldProject({
        name: 'occupied',
        backend: 'node',
        parentDirectory,
      }),
    ).toThrow('not empty')
  })
})
