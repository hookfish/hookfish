import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import https from 'node:https'

export type PortlessApp = 'frontend' | 'server'

const LIVE_POLL_INTERVAL_MS = 250
const LIVE_TIMEOUT_MS = 60_000

function openBrowser(url: string) {
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
}

/** Probe the portless HTTPS URL (self-signed) until the app answers. */
function probeUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      { rejectUnauthorized: false, timeout: 1500 },
      (res) => {
        res.resume()
        const code = res.statusCode ?? 0
        // Proxy 502/503/504 means the alias is up but the app isn't yet.
        resolve(code > 0 && code < 500)
      },
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitUntilLive(
  url: string,
  isCancelled: () => boolean,
): Promise<boolean> {
  const deadline = Date.now() + LIVE_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (isCancelled()) return false
    if (await probeUrl(url)) return true
    await new Promise((resolve) => setTimeout(resolve, LIVE_POLL_INTERVAL_MS))
  }
  return false
}

async function openWhenLive(url: string, child: ChildProcess) {
  const isCancelled = () => child.exitCode !== null || child.signalCode !== null

  const live = await waitUntilLive(url, isCancelled)
  if (isCancelled()) return
  if (!live) {
    console.warn(
      `Timed out waiting for ${url} — opening anyway. If the page fails, refresh once the app is ready.`,
    )
  }
  openBrowser(url)
}

function gitOutput(args: string[]): string {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function getPortlessRoute(appName: PortlessApp) {
  const branch = slug(gitOutput(['branch', '--show-current']))
  const branchPrefix =
    branch && !['main', 'master'].includes(branch) ? branch : ''
  const name = branchPrefix ? `${branchPrefix}.${appName}` : appName

  return {
    routeName: name,
    url: `https://${name}.localhost`,
  }
}

function runSync(
  command: string,
  args: string[],
  options: { stdio?: 'inherit' | 'ignore'; cwd?: string } = {},
) {
  return spawnSync(command, args, {
    stdio: options.stdio ?? 'inherit',
    encoding: 'utf8',
    cwd: options.cwd,
  })
}

function killPort(port: number) {
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

export function runPortlessDev(options: {
  appName: PortlessApp
  command: string[]
  cwd: string
  workspaceRoot: string
  env?: NodeJS.ProcessEnv
}): Promise<number> {
  const { appName, command, cwd, workspaceRoot } = options
  const { routeName, url } = getPortlessRoute(appName)
  const appPort = appName === 'server' ? 8787 : 5173

  runSync('pnpm', ['exec', 'portless', 'proxy', 'start', '--https'], {
    cwd: workspaceRoot,
  })
  killPort(appPort)
  runSync(
    'pnpm',
    ['exec', 'portless', 'alias', routeName, String(appPort), '--force'],
    { cwd: workspaceRoot },
  )

  const env = { ...(options.env ?? process.env) }
  env.PORT = String(appPort)
  env.HOST = env.HOST ?? '127.0.0.1'
  // Providers must redirect to the public HTTPS origin, not localhost:$PORT.
  env.OAUTH_REDIRECT_BASE_URL = env.OAUTH_REDIRECT_BASE_URL ?? url

  const child = spawn(command[0], command.slice(1), {
    cwd,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (appName === 'frontend') {
    void openWhenLive(url, child)
  }

  function cleanup() {
    runSync('pnpm', ['exec', 'portless', 'alias', '--remove', routeName], {
      stdio: 'ignore',
      cwd: workspaceRoot,
    })
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      cleanup()
      child.kill(signal)
    })
  }

  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      cleanup()
      if (signal) {
        resolve(1)
        return
      }
      resolve(code ?? 0)
    })
  })
}
