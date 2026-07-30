#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import {
  getPortlessRoute,
  type PortlessApp,
  runPortlessDev,
} from './portless.js'

/**
 * Resolve the project root from the caller's cwd first so `npx @template/cli`
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
      if (parent === dir) {
        break
      }
      dir = parent
    }
  }
  throw new Error(
    'Could not find workspace root (no pnpm-workspace.yaml). Run from inside the project.',
  )
}

const workspaceRoot = findWorkspaceRoot()

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (signal) {
        resolve(1)
        return
      }
      resolve(code ?? 1)
    })
  })
}

function pnpm(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  return run('pnpm', args, env)
}

function parseApp(app: string): PortlessApp {
  if (app === 'frontend' || app === 'server') {
    return app
  }
  console.error(`Unknown app "${app}". Expected frontend or server.`)
  process.exit(1)
}

async function exitWith(code: number): Promise<never> {
  process.exit(code)
}

const program = new Command()

program.name('template').description('Template monorepo CLI')

program
  .command('migrate')
  .description(
    'Run database migrations (DATABASE_URL / POSTGRES_URL, or local PGlite)',
  )
  .action(async () => {
    const url =
      process.env.POSTGRES_URL?.trim() || process.env.DATABASE_URL?.trim()
    const env = { ...process.env }
    if (url) {
      env.DATABASE_URL = url
    }
    await exitWith(
      await pnpm(['--filter', '@template/api', 'db:migrate'], env),
    )
  })

program
  .command('dev')
  .description('Run the frontend behind portless')
  .action(async () => {
    await exitWith(
      await runPortlessDev({
        appName: 'frontend',
        cwd: path.join(workspaceRoot, 'apps/frontend'),
        workspaceRoot,
        command: [
          'pnpm',
          'exec',
          'vite',
          '--host',
          process.env.HOST ?? '127.0.0.1',
          '--port',
          '5173',
        ],
      }),
    )
  })

program
  .command('dev:server')
  .description('Run the server behind portless')
  .action(async () => {
    await exitWith(
      await runPortlessDev({
        appName: 'server',
        cwd: path.join(workspaceRoot, 'apps/server'),
        workspaceRoot,
        command: ['pnpm', 'exec', 'tsx', 'watch', 'src/node.ts'],
      }),
    )
  })

program
  .command('portless')
  .description('Run a command behind the portless proxy')
  .argument('<app>', 'frontend or server')
  .argument('<command...>', 'command to run')
  .action(async (app: string, command: string[]) => {
    const appName = parseApp(app)
    if (command.length === 0) {
      console.error('Missing command to run behind portless.')
      await exitWith(1)
    }
    await exitWith(
      await runPortlessDev({
        appName,
        cwd: path.join(workspaceRoot, 'apps', appName),
        workspaceRoot,
        command,
      }),
    )
  })

program
  .command('urls')
  .description('Print portless URLs for local apps')
  .argument('[app]', 'frontend or server')
  .action((app?: string) => {
    if (app) {
      console.log(getPortlessRoute(parseApp(app)).url)
      return
    }
    for (const name of ['frontend', 'server'] as const) {
      console.log(`${name}: ${getPortlessRoute(name).url}`)
    }
  })

await program.parseAsync(process.argv)
