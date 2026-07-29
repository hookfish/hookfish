#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { getPortlessRoute } from './portless-utils.mjs'

const [, , appName, separator, ...command] = process.argv

if (!appName || separator !== '--' || command.length === 0) {
  console.error(
    'Usage: node scripts/portless-dev.mjs <app-name> -- <command...>',
  )
  process.exit(1)
}

const { routeName, serverUrl } = getPortlessRoute(appName)
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

if (appName === 'frontend' && !env.VITE_API_BASE_URL) {
  env.VITE_API_BASE_URL = serverUrl
}

const child = spawn(command[0], command.slice(1), {
  env,
  stdio: 'inherit',
})

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
