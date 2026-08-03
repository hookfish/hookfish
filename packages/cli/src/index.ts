#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'

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

const program = new Command()

program.name('hookfish').description('OAuth broker CLI')

program
  .command('serve')
  .description('Run the frontend with the Hookfish API mounted at /api')
  .action(async () => {
    await exitWith(await run('pnpm', ['--filter', '@hookfish/frontend', 'dev']))
  })

program
  .command('migrate')
  .description(
    'Run database migrations (DATABASE_URL / POSTGRES_URL, or local PGlite)',
  )
  .action(async () => {
    const url =
      process.env.POSTGRES_URL?.trim() || process.env.DATABASE_URL?.trim()
    const env = { ...process.env }
    if (url) env.DATABASE_URL = url
    await exitWith(
      await run('pnpm', ['--filter', '@hookfish/api', 'db:migrate'], env),
    )
  })

await program.parseAsync(process.argv)
