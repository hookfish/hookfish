#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { clearLine, cursorTo } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Command, Option } from 'commander'
import { register } from 'tsx/esm/api'

/**
 * Resolve the project root from the caller's cwd first so `npx @hookfish/cli`
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
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: findWorkspaceRoot(),
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

function developmentEnvironment(): NodeJS.ProcessEnv {
  const envPath = path.join(findWorkspaceRoot(), 'apps/frontend/.env')
  if (existsSync(envPath)) process.loadEnvFile(envPath)

  const allocatedPort = parsePort(process.env.CONDUCTOR_PORT)
  const requestedPort = parsePort(process.env.PORT)
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
    FRONTEND_PORT: String(frontendPort),
    HOOKFISH_BACKEND_PORT: String(backendPort),
    HOOKFISH_BACKEND_URL:
      process.env.HOOKFISH_BACKEND_URL ?? `http://127.0.0.1:${backendPort}`,
    HOOKFISH_FRONTEND_URL:
      process.env.HOOKFISH_FRONTEND_URL ?? `http://127.0.0.1:${frontendPort}`,
  }

  const hyperdriveLocalConnectionString =
    process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ??
    process.env.DATABASE_URL
  if (hyperdriveLocalConnectionString) {
    environment.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE =
      hyperdriveLocalConnectionString
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
  .command('dev')
  .alias('serve')
  .description('Run the frontend with a selected backend')
  .addOption(
    new Option('-b, --backend <name>', 'Backend example to run')
      .choices([...developmentBackends.keys()])
      .default('hono-node'),
  )
  .option('--no-open', 'Do not open the frontend in a browser')
  .action(async (options: { backend: string; open: boolean }) => {
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
  })

program
  .command('migrate')
  .description('Run migrations using a Hookfish runtime config')
  .option(
    '-c, --config <path>',
    'Hookfish config path relative to the workspace root',
    'hookfish.config.ts',
  )
  .action(async (options: { config: string }) => {
    const configPath = path.resolve(findWorkspaceRoot(), options.config)
    if (!existsSync(configPath)) {
      program.error(`Hookfish config not found: ${configPath}`)
    }
    console.log(`Reading config file '${configPath}'`)

    const unregister = register()
    try {
      const configModule = await import(pathToFileURL(configPath).href)
      const config = Reflect.get(configModule, 'default')
      const db =
        typeof config === 'object' && config !== null
          ? Reflect.get(config, 'db')
          : undefined
      const migrate =
        typeof db === 'object' && db !== null
          ? Reflect.get(db, 'migrate')
          : undefined

      if (!db || typeof migrate !== 'function') {
        program.error(
          `${options.config} must default-export a HookfishConfig whose database supports migrations.`,
        )
      }

      await withMigrationProgress(() =>
        Reflect.apply(migrate, db, [process.env]),
      )
    } finally {
      await unregister()
    }
  })

await program.parseAsync(process.argv)
