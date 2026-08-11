#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { clearLine, cursorTo } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Command, Option } from 'commander'
import { serve } from 'srvx'
import { serveStatic } from 'srvx/static'
import { inspectorServerConfig } from './inspector-server.js'
import {
  dependencyTagForVersion,
  isScaffoldBackend,
  type ScaffoldBackend,
  scaffoldBackends,
  scaffoldProject,
} from './scaffold.js'
import { defaultFrontendHostname, proxyBackendRequest } from './serve.js'

function packageVersion(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('The Hookfish package manifest must contain an object.')
  }
  const version = Reflect.get(manifest, 'version')
  if (typeof version !== 'string') {
    throw new Error('The Hookfish package manifest must contain a version.')
  }
  return version
}

/**
 * Resolve the project root from the caller's cwd first so `npx hookfish`
 * works when the package lives in the npm cache / node_modules. Fall back to
 * walking from this file for local monorepo checkouts.
 */
function findWorkspaceRoot(): string {
  const starts = [process.cwd(), path.dirname(fileURLToPath(import.meta.url))]
  for (const start of starts) {
    let dir = start
    for (;;) {
      if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
        return dir
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  throw new Error(
    'Could not find workspace root (no pnpm-workspace.yaml). Run from inside the project.',
  )
}

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = findWorkspaceRoot(),
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    const forwardSigint = () => child.kill('SIGINT')
    const forwardSigterm = () => child.kill('SIGTERM')
    const removeSignalHandlers = () => {
      process.off('SIGINT', forwardSigint)
      process.off('SIGTERM', forwardSigterm)
    }

    process.on('SIGINT', forwardSigint)
    process.on('SIGTERM', forwardSigterm)
    child.on('error', (error) => {
      removeSignalHandlers()
      reject(error)
    })
    child.on('close', (code, signal) => {
      removeSignalHandlers()
      resolve(signal ? 1 : (code ?? 1))
    })
  })
}

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

function packageManager(directory: string): PackageManager {
  if (existsSync(path.join(directory, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(path.join(directory, 'yarn.lock'))) return 'yarn'
  if (
    existsSync(path.join(directory, 'bun.lock')) ||
    existsSync(path.join(directory, 'bun.lockb'))
  ) {
    return 'bun'
  }

  const agent = process.env.npm_config_user_agent?.split('/')[0]
  if (agent === 'pnpm' || agent === 'yarn' || agent === 'bun') return agent
  return 'npm'
}

async function exitWith(code: number): Promise<never> {
  process.exit(code)
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port < 65_535 ? port : undefined
}

function followingPort(port: number | undefined): number | undefined {
  return port && port < 65_534 ? port + 1 : undefined
}

function browserHostname(hostname: string): string {
  if (hostname === '0.0.0.0' || hostname === '::') return 'localhost'
  return hostname.includes(':') ? `[${hostname}]` : hostname
}

type HookfishProject = {
  backend: ScaffoldBackend
  backendPort?: number
}

function hookfishProject(
  directory = process.cwd(),
): HookfishProject | undefined {
  const manifestPath = path.join(directory, 'hookfish.project.json')
  if (!existsSync(manifestPath)) return undefined

  const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('hookfish.project.json must contain an object.')
  }

  const backend = Reflect.get(parsed, 'backend')
  const backendPort = Reflect.get(parsed, 'backendPort')
  if (typeof backend !== 'string' || !isScaffoldBackend(backend)) {
    throw new Error(
      `hookfish.project.json backend must be one of: ${scaffoldBackends.join(', ')}`,
    )
  }
  let normalizedBackendPort: number | undefined
  if (
    backendPort !== undefined &&
    (typeof backendPort !== 'number' ||
      !Number.isInteger(backendPort) ||
      backendPort <= 0 ||
      backendPort >= 65_535)
  ) {
    throw new Error('hookfish.project.json backendPort must be a valid port.')
  }
  if (typeof backendPort === 'number') normalizedBackendPort = backendPort

  return { backend, backendPort: normalizedBackendPort }
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open'
  const child = spawn(command, [url], {
    detached: true,
    shell: process.platform === 'win32',
    stdio: 'ignore',
  })
  child.once('error', () => undefined)
  child.unref()
}

async function runScaffoldedProject(
  project: HookfishProject | undefined,
  shouldOpen: boolean,
  configuredBackendUrl: string | undefined,
): Promise<number> {
  const directory = process.cwd()
  const envPath = path.join(directory, '.env')
  if (existsSync(envPath)) process.loadEnvFile(envPath)

  const allocatedPort = parsePort(process.env.CONDUCTOR_PORT)
  const requestedPort = parsePort(process.env.PORT)
  const frontendHostname = defaultFrontendHostname
  const frontendHost = process.env.FRONTEND_HOST ?? frontendHostname
  const frontendPort =
    parsePort(process.env.FRONTEND_PORT) ??
    allocatedPort ??
    requestedPort ??
    5173
  const backendPort =
    parsePort(process.env.HOOKFISH_BACKEND_PORT) ??
    followingPort(allocatedPort) ??
    followingPort(requestedPort) ??
    project?.backendPort ??
    8787
  const frontendOrigin = `http://${browserHostname(frontendHost)}:${frontendPort}`
  const backendOrigin =
    configuredBackendUrl ??
    process.env.HOOKFISH_BACKEND_URL ??
    `http://127.0.0.1:${backendPort}`
  const parsedBackendUrl = new URL(backendOrigin)
  if (!['http:', 'https:'].includes(parsedBackendUrl.protocol)) {
    throw new Error('--backend-url must use http or https.')
  }

  const frontendDirectory = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'frontend',
  )
  const indexPath = path.join(frontendDirectory, 'index.html')
  if (!existsSync(indexPath)) {
    throw new Error(
      'The packaged Hookfish frontend is missing. Reinstall hookfish and try again.',
    )
  }
  const indexHtml = readFileSync(indexPath)
  const server = serve({
    manual: true,
    silent: true,
    gracefulShutdown: false,
    hostname: frontendHost,
    port: frontendPort,
    middleware: [serveStatic({ dir: frontendDirectory })],
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        const target = new URL(`${url.pathname}${url.search}`, backendOrigin)
        try {
          return await proxyBackendRequest(request, target)
        } catch (error) {
          return Response.json(
            {
              error: 'backend_unavailable',
              message: error instanceof Error ? error.message : String(error),
            },
            { status: 502 },
          )
        }
      }

      return new Response(indexHtml, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    },
  })
  await server.serve()
  process.stdout.write(
    `Hookfish frontend running at ${frontendOrigin} (${project?.backend ?? 'external'} backend: ${backendOrigin})\n`,
  )
  if (shouldOpen) openBrowser(frontendOrigin)

  return await new Promise<number>((resolve, reject) => {
    let stopping = false
    const stop = () => {
      if (stopping) return
      stopping = true
      void server.close().then(() => resolve(0), reject)
    }
    const onSigint = () => stop()
    const onSigterm = () => stop()

    process.on('SIGINT', onSigint)
    process.on('SIGTERM', onSigterm)
  })
}

type InspectorServerEntry = {
  default: {
    fetch: (request: Request) => Response | Promise<Response>
  }
}

type InspectorProcessLock = {
  version: 1
  pid: number
  port: number
  token: string
}

const inspectorShutdownPath = '/__hookfish/inspector/shutdown'

function inspectorLockPath(dataDirectory: string): string {
  return `${dataDirectory}.lock`
}

function readInspectorLock(lockPath: string): InspectorProcessLock | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(lockPath, 'utf8'))
    if (!value || typeof value !== 'object') return undefined
    const version = Reflect.get(value, 'version')
    const pid = Reflect.get(value, 'pid')
    const port = Reflect.get(value, 'port')
    const token = Reflect.get(value, 'token')
    if (
      version !== 1 ||
      !Number.isInteger(pid) ||
      typeof pid !== 'number' ||
      pid <= 0 ||
      !Number.isInteger(port) ||
      typeof port !== 'number' ||
      port <= 0 ||
      typeof token !== 'string' ||
      token.length < 32
    ) {
      return undefined
    }
    return { version, pid, port, token }
  } catch {
    return undefined
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function removeInspectorLock(
  lockPath: string,
  expected: InspectorProcessLock,
): void {
  const current = readInspectorLock(lockPath)
  if (current?.pid !== expected.pid || current.token !== expected.token) return
  try {
    unlinkSync(lockPath)
  } catch {
    // The owner may have removed its lock concurrently.
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return !isProcessAlive(pid)
}

async function stopLockedInspector(lock: InspectorProcessLock) {
  if (!isProcessAlive(lock.pid)) return

  let accepted = false
  try {
    const response = await fetch(
      `http://127.0.0.1:${lock.port}${inspectorShutdownPath}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${lock.token}` },
        signal: AbortSignal.timeout(1_000),
      },
    )
    accepted = response.status === 202
  } catch {
    // A proxy wrapper may already have stopped the process.
  }

  if (await waitForProcessExit(lock.pid, accepted ? 2_000 : 500)) return
  throw new Error(
    'Another Hookfish inspector is still using the local database. Stop it and try again.',
  )
}

async function claimInspectorProcess(dataDirectory: string, port: number) {
  const lockPath = inspectorLockPath(dataDirectory)
  mkdirSync(path.dirname(dataDirectory), { recursive: true })

  for (let attempt = 0; attempt < 3; attempt++) {
    const lockExists = existsSync(lockPath)
    const existing = readInspectorLock(lockPath)
    if (lockExists && !existing) {
      throw new Error(
        `The Hookfish inspector lock at ${lockPath} is invalid. Remove it after confirming no inspector is running.`,
      )
    }
    if (existing && existing.pid !== process.pid) {
      await stopLockedInspector(existing)
      removeInspectorLock(lockPath, existing)
    }

    const lock: InspectorProcessLock = {
      version: 1,
      pid: process.pid,
      port,
      token: randomBytes(32).toString('hex'),
    }
    try {
      writeFileSync(lockPath, `${JSON.stringify(lock)}\n`, {
        flag: 'wx',
        mode: 0o600,
      })
      let released = false
      const release = () => {
        if (released) return
        released = true
        removeInspectorLock(lockPath, lock)
      }
      return {
        release,
        acceptsShutdown(request: Request) {
          return (
            request.method === 'POST' &&
            new URL(request.url).pathname === inspectorShutdownPath &&
            request.headers.get('Authorization') === `Bearer ${lock.token}`
          )
        },
      }
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      ) {
        throw error
      }
    }
  }

  throw new Error('Could not claim the local Hookfish inspector database.')
}

function isInspectorServerEntry(value: unknown): value is InspectorServerEntry {
  if (!value || typeof value !== 'object') return false
  const entry = Reflect.get(value, 'default')
  return (
    Boolean(entry) &&
    typeof entry === 'object' &&
    typeof Reflect.get(entry, 'fetch') === 'function'
  )
}

async function startInspector(
  hostname: string,
  port: number,
  origin: string,
): Promise<void> {
  const inspectorDirectory = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'inspector',
  )
  const serverEntry = path.join(inspectorDirectory, 'server', 'server.js')
  if (!existsSync(serverEntry)) {
    throw new Error(
      'The packaged inspector is missing. Reinstall hookfish and try again.',
    )
  }

  process.env.PGLITE_DATA_DIR ??= path.join(homedir(), '.hookfish', 'inspector')
  process.env.HOOKFISH_FRONTEND_URL ??= origin
  process.env.OAUTH_REDIRECT_BASE_URL ??= origin

  const processLock = await claimInspectorProcess(
    process.env.PGLITE_DATA_DIR,
    port,
  )
  let server: ReturnType<typeof serve> | undefined
  let shuttingDown = false
  const shutdown = async (exitCode: number) => {
    if (shuttingDown) return
    shuttingDown = true
    const forceExit = setTimeout(() => {
      processLock.release()
      process.exit(exitCode)
    }, 500)
    forceExit.unref()
    await server?.close(true).catch(() => undefined)
    clearTimeout(forceExit)
    processLock.release()
    process.exit(exitCode)
  }
  const onSigint = () => void shutdown(130)
  const onSigterm = () => void shutdown(143)
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)
  process.once('exit', processLock.release)

  try {
    const entry: unknown = await import(pathToFileURL(serverEntry).href)
    if (!isInspectorServerEntry(entry)) {
      throw new Error('The packaged inspector server entry is invalid.')
    }
    server = serve({
      manual: true,
      silent: true,
      hostname,
      port,
      middleware: [
        serveStatic({ dir: path.join(inspectorDirectory, 'client') }),
      ],
      fetch: (request) => {
        if (processLock.acceptsShutdown(request)) {
          setTimeout(() => void shutdown(0), 25)
          return new Response(null, { status: 202 })
        }
        return entry.default.fetch(request)
      },
    })
    await server.serve()
    process.stdout.write(`Hookfish MCP Inspector running at ${origin}\n`)
  } catch (error) {
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
    processLock.release()
    throw error
  }
}

function loadDevelopmentEnvironment(): void {
  const envPath = path.join(findWorkspaceRoot(), 'apps/frontend/.env')
  if (existsSync(envPath)) process.loadEnvFile(envPath)
}

function developmentEnvironment(): NodeJS.ProcessEnv {
  loadDevelopmentEnvironment()

  const allocatedPort = parsePort(process.env.CONDUCTOR_PORT)
  const requestedPort = parsePort(process.env.PORT)
  const frontendHostname = allocatedPort ? 'localhost' : '127.0.0.1'
  const frontendPort =
    parsePort(process.env.FRONTEND_PORT) ??
    allocatedPort ??
    requestedPort ??
    5173
  const backendPort =
    parsePort(process.env.HOOKFISH_BACKEND_PORT) ??
    followingPort(allocatedPort) ??
    followingPort(requestedPort) ??
    8787

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    FRONTEND_HOST: process.env.FRONTEND_HOST ?? frontendHostname,
    FRONTEND_PORT: String(frontendPort),
    PORT: String(backendPort),
    HOOKFISH_BACKEND_URL:
      process.env.HOOKFISH_BACKEND_URL ?? `http://127.0.0.1:${backendPort}`,
    HOOKFISH_FRONTEND_URL:
      process.env.HOOKFISH_FRONTEND_URL ??
      `http://${frontendHostname}:${frontendPort}`,
  }

  return environment
}

const migrationFrames = ['⣷', '⣯', '⣟', '⡿', '⢿', '⣻', '⣽', '⣾']

async function withMigrationProgress(migrate: () => Promise<void>) {
  let frame = 0
  const render = () => {
    if (process.stdout.isTTY) cursorTo(process.stdout, 0)
    process.stdout.write(
      `[${migrationFrames[frame % migrationFrames.length]}] applying migrations...`,
    )
    frame += 1
  }

  render()
  const timer = process.stdout.isTTY ? setInterval(render, 128) : undefined
  if (!process.stdout.isTTY) process.stdout.write('\n')

  try {
    await migrate()
    if (timer) clearInterval(timer)
    if (process.stdout.isTTY) {
      clearLine(process.stdout, 0)
      cursorTo(process.stdout, 0)
    }
    const check = process.stdout.isTTY ? '\u001B[32m✓\u001B[39m' : '✓'
    process.stdout.write(`[${check}] migrations applied successfully!\n`)
  } catch (error) {
    if (timer) clearInterval(timer)
    if (process.stdout.isTTY) {
      clearLine(process.stdout, 0)
      cursorTo(process.stdout, 0)
    }
    throw error
  }
}

const program = new Command()

const developmentBackends = new Map<string, string>([
  ['hono-node', '@hookfish/example-hono-node'],
  ['express', '@hookfish/example-express'],
  ['nextjs', '@hookfish/example-nextjs'],
  ['cloudflare-worker', '@hookfish/example-cloudflare-worker'],
])

function developmentBackendPackage(backend: string): string {
  const packageName = developmentBackends.get(backend)
  if (!packageName) {
    throw new Error(`Unsupported development backend: ${backend}`)
  }
  return packageName
}

program.name('hookfish').description('OAuth broker CLI')

program
  .command('init')
  .description('Scaffold a deployable Hookfish project')
  .argument('<name>', 'Project name and directory')
  .option(
    '-b, --backend <backend>',
    `Deployment backend (${scaffoldBackends.join(', ')})`,
    'node',
  )
  .option('--no-install', 'Skip dependency installation')
  .action(
    async (name: string, options: { backend: string; install: boolean }) => {
      const backend = options.backend.toLowerCase()
      if (!isScaffoldBackend(backend)) {
        throw new Error(
          `Unsupported backend "${options.backend}". Choose one of: ${scaffoldBackends.join(', ')}`,
        )
      }

      const result = scaffoldProject({
        name,
        backend,
        dependencyTag: dependencyTagForVersion(packageVersion()),
      })
      process.stdout.write(
        `Created ${name} with the ${backend} backend at ${result.directory}\n`,
      )

      if (options.install) {
        const manager = packageManager(result.directory)
        process.stdout.write(`Installing dependencies with ${manager}...\n`)
        const code = await run(
          manager,
          ['install'],
          process.env,
          result.directory,
        )
        if (code !== 0) await exitWith(code)
      }

      const manager = packageManager(result.directory)
      process.stdout.write(
        `\nNext steps:\n  cd ${name}\n  ${manager} run dev\n`,
      )
    },
  )

program
  .command('dev')
  .alias('serve')
  .description('Run the Hookfish frontend and backend')
  .addOption(
    new Option('-b, --backend <name>', 'Backend example to run')
      .choices([...developmentBackends.keys()])
      .default('hono-node'),
  )
  .option('--no-open', 'Do not open the frontend in a browser')
  .option('--backend-url <url>', 'Backend URL for the packaged frontend')
  .action(
    async (options: {
      backend: string
      backendUrl?: string
      open: boolean
    }) => {
      const project = hookfishProject()
      if (project || options.backendUrl) {
        await exitWith(
          await runScaffoldedProject(project, options.open, options.backendUrl),
        )
      }

      const backendPackage = developmentBackendPackage(options.backend)
      const args = [
        'exec',
        'turbo',
        'dev',
        '--env-mode=loose',
        '--filter=@hookfish/frontend',
        `--filter=${backendPackage}`,
      ]
      const environment = developmentEnvironment()
      await exitWith(
        await run('pnpm', args, {
          ...environment,
          HOOKFISH_OPEN: options.open ? 'true' : 'false',
        }),
      )
    },
  )

program
  .command('inspect')
  .alias('inspector')
  .description('Run the inspector')
  .action(async () => {
    const inspector = inspectorServerConfig()
    await startInspector(inspector.host, inspector.port, inspector.origin)
  })

program
  .command('migrate')
  .description('Run migrations for a selected backend database')
  .addOption(
    new Option('-b, --backend <name>', 'Backend database to migrate')
      .choices([...developmentBackends.keys()])
      .default('hono-node'),
  )
  .action(async (options: { backend: string }) => {
    loadDevelopmentEnvironment()

    if (options.backend === 'cloudflare-worker') {
      process.stdout.write(
        'Cloudflare Durable Object databases migrate lazily when each object starts.\n',
      )
      return
    }

    const { pglite } = await import('@hookfish/database/pglite')
    const database = pglite(
      process.env.PGLITE_DATA_DIR ?? path.join(findWorkspaceRoot(), 'pgdata'),
    )
    await withMigrationProgress(async () => {
      await database.migrate?.({})
    })
  })

await program.parseAsync(process.argv)
