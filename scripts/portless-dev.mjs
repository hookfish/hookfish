#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPortlessRoute } from './portless-utils.mjs'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

const [, , appName, separator, ...command] = process.argv

if (!appName || separator !== '--' || command.length === 0) {
  console.error(
    'Usage: node scripts/portless-dev.mjs <app-name> -- <command...>',
  )
  process.exit(1)
}

const { routeName, url } = getPortlessRoute(appName)
const appPort = appName === 'server' ? 8787 : 5173

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    stdio: options.stdio ?? 'inherit',
    encoding: 'utf8',
  })
}

function killPort(port) {
  const result = spawnSync('lsof', ['-ti', `tcp:${port}`], {
    encoding: 'utf8',
  })
  const pids = result.stdout
    .split('\n')
    .map((pid) => pid.trim())
    .filter(Boolean)

  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGTERM')
    } catch {
      // Process may have exited between lsof and kill.
    }
  }
}

run('pnpm', ['exec', 'portless', 'proxy', 'start', '--https'])
killPort(appPort)
run('pnpm', [
  'exec',
  'portless',
  'alias',
  routeName,
  String(appPort),
  '--force',
])

const env = { ...process.env }
env.PORT = String(appPort)
env.HOST = env.HOST ?? '127.0.0.1'

// OAuth callbacks must be absolute and must byte-match what is registered with
// the provider, so hand the API this branch's stable portless origin as
// BASE_URL instead of making every dev set it by hand.
//
// Read apps/server/.env first: the API loads it later via `loadEnvFile`, which
// does not overwrite already-set vars, so defaulting BASE_URL here without
// looking would silently outrank a value the dev put in .env.
try {
  process.loadEnvFile(path.join(repoRoot, 'apps/server/.env'))
} catch {
  // No .env yet -- the portless origin is the right default anyway.
}
env.BASE_URL = process.env.BASE_URL ?? url

const child = spawn(command[0], command.slice(1), {
  env,
  stdio: 'inherit',
})

if (appName === 'frontend') {
  // Brief delay so Vite/portless are listening before the browser hits the URL.
  setTimeout(() => {
    if (process.platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], {
        stdio: 'ignore',
        detached: true,
      }).unref()
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref()
    }
  }, 1500)
}

function cleanup() {
  run('pnpm', ['exec', 'portless', 'alias', '--remove', routeName], {
    stdio: 'ignore',
  })
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    cleanup()
    child.kill(signal)
  })
}

child.on('exit', (code, signal) => {
  cleanup()
  if (signal) {
    process.kill(process.pid, signal)
  }
  process.exit(code ?? 0)
})
