import { spawn, spawnSync } from 'node:child_process'

export type PortlessApp = 'frontend' | 'server'

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

  const env = { ...process.env }
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
