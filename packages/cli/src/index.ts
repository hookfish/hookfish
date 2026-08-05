#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { clearLine, cursorTo } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Command } from 'commander'
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

program.name('hookfish').description('OAuth broker CLI')

program
  .command('serve')
  .description('Run the frontend with the Hookfish API mounted at /api')
  .option('--no-open', 'Do not open the frontend in a browser')
  .action(async (options: { open: boolean }) => {
    const args = ['--filter', '@hookfish/frontend', 'dev']
    if (options.open) args.push('--open')

    await exitWith(await run('pnpm', args))
  })

program
  .command('migrate')
  .description('Run migrations using the database in hookfish.config.ts')
  .action(async () => {
    const configPath = path.join(findWorkspaceRoot(), 'hookfish.config.ts')
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
          'hookfish.config.ts must default-export a HookfishConfig whose database supports migrations.',
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
