import { spawn } from 'node:child_process'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

const mode = process.argv[2]
if (mode !== 'dev' && mode !== 'build' && mode !== 'start') {
  throw new Error('Expected one of: dev, build, start.')
}

const configuredPort = Number(process.env.PGLITE_PORT ?? '54329')
if (!Number.isInteger(configuredPort) || configuredPort < 1) {
  throw new Error('PGLITE_PORT must be a positive integer.')
}

const host = '127.0.0.1'
const dataDirectory =
  mode === 'build' ? 'memory://' : (process.env.PGLITE_DATA_DIR ?? './pgdata')

const database = await PGlite.create(dataDirectory)
const server = new PGLiteSocketServer({
  db: database,
  host,
  port: configuredPort,
  maxConnections: 20,
})

await server.start()

const databaseUrl = `postgresql://postgres:postgres@${host}:${configuredPort}/postgres`
const packageManager = process.env.npm_execpath
const command = packageManager ? process.execPath : 'pnpm'
const args = packageManager
  ? [packageManager, `${mode}:next`]
  : [`${mode}:next`]
const child = spawn(command, args, {
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: 'inherit',
})

const forwardSignal = (signal: NodeJS.Signals) => child.kill(signal)
process.once('SIGINT', forwardSignal)
process.once('SIGTERM', forwardSignal)

let exitCode = 1
try {
  exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
} finally {
  process.removeListener('SIGINT', forwardSignal)
  process.removeListener('SIGTERM', forwardSignal)
  await server.stop()
  await database.close()
}

process.exitCode = exitCode
