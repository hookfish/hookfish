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
    const encryptionKey = environment.match(/^OAUTH_ENCRYPTION_KEY=(.+)$/m)?.[1]
    const brokerApiKey = environment.match(/^HOOKFISH_API_KEY=(.+)$/m)?.[1]

    expect(encryptionKey).toMatch(/^[A-Za-z0-9+/]{43}=$/)
    expect(brokerApiKey).toMatch(/^[A-Za-z0-9+/]{43}=$/)
    expect(brokerApiKey).not.toBe(encryptionKey)
    expect(brokerApiKey).not.toBe('test')

    const providerFile =
      backend === 'cloudflare' ? 'src/index.ts' : 'hookfish.config.ts'
    const providerConfig = readFileSync(
      path.join(result.directory, providerFile),
      'utf8',
    )
    expect(providerConfig).toContain('mcp: createMcpProvider()')
    expect(providerConfig).toContain('secret: createSecretProvider()')
    expect(providerConfig).not.toContain('createGitHubProvider')
    expect(providerConfig).not.toContain('createLinearProvider')
    expect(providerConfig).not.toContain('createNotionProvider')
    expect(environment).not.toContain('GITHUB_CLIENT_ID')
    expect(environment).not.toContain('LINEAR_CLIENT_ID')
    expect(environment).not.toContain('NOTION_CLIENT_ID')
  })

  it.each(
    scaffoldBackends,
  )('records the Hookfish attribution requirement in the %s AGENTS.md', (backend) => {
    const parentDirectory = temporaryDirectory()
    const { directory, files } = scaffoldProject({
      name: `broker-agents-${backend}`,
      backend,
      parentDirectory,
    })
    const agents = readFileSync(path.join(directory, 'AGENTS.md'), 'utf8')

    expect(files).toContain('AGENTS.md')
    expect(agents).toContain(
      'uses [Hookfish](https://github.com/hookfish/hookfish)',
    )
    expect(agents).toContain(
      'https://github.com/hookfish/hookfish/blob/main/LICENSE',
    )
    expect(agents).toContain('end-user-facing application')
    expect(agents).toContain('you must credit')
    expect(agents).toContain(
      backend === 'cloudflare'
        ? '`src/index.ts` configures'
        : '`hookfish.config.ts` configures',
    )
    expect(readFileSync(path.join(directory, 'README.md'), 'utf8')).toContain(
      '## Attribution',
    )
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

  it.each([
    'node',
    'docker',
    'vercel',
  ] as const)('mounts Hookfish in the generated %s Hono application', (backend) => {
    const parentDirectory = temporaryDirectory()
    const { directory } = scaffoldProject({
      name: `broker-hono-${backend}`,
      backend,
      parentDirectory,
    })
    const server = readFileSync(path.join(directory, 'src/index.ts'), 'utf8')

    expect(packageFile(directory).dependencies.hono).toBe('^4.12.34')
    expect(server).toContain("import { Hono } from 'hono'")
    expect(server).toContain("app.route('/', hookfishServer)")
  })

  it('uses PostgreSQL through Hyperdrive for Cloudflare', () => {
    const parentDirectory = temporaryDirectory()
    const { directory } = scaffoldProject({
      name: 'broker-cloudflare',
      backend: 'cloudflare',
      parentDirectory,
    })
    const configSource = readFileSync(
      path.join(directory, 'wrangler.jsonc'),
      'utf8',
    )
    const config = JSON.parse(configSource.replace(/^\s*\/\/.*$/gm, ''))
    const worker = readFileSync(path.join(directory, 'src/index.ts'), 'utf8')
    const migration = readFileSync(
      path.join(directory, 'src/migrate.ts'),
      'utf8',
    )
    const migrationEnvironment = readFileSync(
      path.join(directory, '.env'),
      'utf8',
    )
    const workerEnvironment = readFileSync(
      path.join(directory, '.dev.vars'),
      'utf8',
    )
    const tsconfig = JSON.parse(
      readFileSync(path.join(directory, 'tsconfig.json'), 'utf8'),
    )

    expect(config.hyperdrive).toEqual([
      { binding: 'HYPERDRIVE', id: '<YOUR_HYPERDRIVE_ID>' },
    ])
    expect(config.durable_objects).toBeUndefined()
    expect(config.exports).toBeUndefined()
    expect(config.migrations).toBeUndefined()
    expect(configSource).toContain('// Hyperdrive setup:')
    expect(configSource).toContain(
      'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE',
    )
    expect(worker).toContain(
      "import { postgres } from '@hookfish/database/postgres'",
    )
    expect(worker).toContain('bindings.HYPERDRIVE.connectionString')
    expect(worker).toContain('cache: false')
    expect(migration).toContain('await migrateDatabase')
    expect(migrationEnvironment).toContain('DATABASE_URL=')
    expect(workerEnvironment).not.toContain('DATABASE_URL=')
    expect(tsconfig.compilerOptions.lib).toEqual(['ES2023'])
    expect(packageFile(directory).scripts.migrate).toContain('--env-file=.env')
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
