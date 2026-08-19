import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
)
const backends = new Map([
  ['hono-node', '@hookfish/example-hono-node'],
  ['express', '@hookfish/example-express'],
  ['nextjs', '@hookfish/example-nextjs'],
  ['cloudflare-worker', '@hookfish/example-cloudflare-worker'],
])

function parsePort(value) {
  if (!value) return undefined
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port < 65_535 ? port : undefined
}

function selectedBackend() {
  const index = process.argv.findIndex(
    (argument) => argument === '--backend' || argument === '-b',
  )
  return index === -1 ? 'hono-node' : process.argv[index + 1]
}

const backend = selectedBackend()
const backendPackage = backends.get(backend)
if (!backendPackage) {
  throw new Error(
    `Unsupported development backend "${backend}". Choose one of: ${[
      ...backends.keys(),
    ].join(', ')}`,
  )
}

const envPath = path.join(workspaceRoot, 'apps/frontend/.env')
if (existsSync(envPath)) process.loadEnvFile(envPath)

const allocatedPort = parsePort(process.env.CONDUCTOR_PORT)
const requestedPort = parsePort(process.env.PORT)
const frontendPort =
  parsePort(process.env.FRONTEND_PORT) ?? allocatedPort ?? requestedPort ?? 5173
const backendPort =
  parsePort(process.env.HOOKFISH_BACKEND_PORT) ??
  (frontendPort < 65_534 ? frontendPort + 1 : 8787)
const frontendHost = process.env.FRONTEND_HOST ?? '127.0.0.1'
const shouldOpen = !process.argv.includes('--no-open')
const environment = {
  ...process.env,
  FRONTEND_HOST: frontendHost,
  FRONTEND_PORT: String(frontendPort),
  PORT: String(backendPort),
  HOOKFISH_API_KEY: process.env.HOOKFISH_API_KEY?.trim() || 'test',
  HOOKFISH_BACKEND_URL:
    process.env.HOOKFISH_BACKEND_URL ?? `http://127.0.0.1:${backendPort}`,
  HOOKFISH_FRONTEND_URL:
    process.env.HOOKFISH_FRONTEND_URL ??
    `http://${frontendHost}:${frontendPort}`,
  HOOKFISH_OPEN: process.env.HOOKFISH_OPEN ?? (shouldOpen ? 'true' : 'false'),
}

const child = spawn(
  'pnpm',
  [
    'exec',
    'turbo',
    'dev',
    '--env-mode=loose',
    `--filter=${backendPackage}`,
    '--filter=@hookfish/frontend',
  ],
  {
    cwd: workspaceRoot,
    env: environment,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
child.once('error', (error) => {
  process.stderr.write(
    `Hookfish repository development failed: ${error.message}\n`,
  )
  process.exitCode = 1
})
child.once('close', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1)
})
