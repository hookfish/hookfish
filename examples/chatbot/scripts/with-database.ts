import { spawn } from 'node:child_process'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import nextEnv from '@next/env'

nextEnv.loadEnvConfig(process.cwd())

const action = process.argv[2]
const supportedActions = ['dev', 'build', 'start', 'db:migrate', 'db:studio']
if (!action || !supportedActions.includes(action)) {
  throw new Error(`Expected one of: ${supportedActions.join(', ')}.`)
}

const configuredPort = Number(process.env.PGLITE_PORT ?? '54329')
if (!Number.isInteger(configuredPort) || configuredPort < 1) {
  throw new Error('PGLITE_PORT must be a positive integer.')
}

const host = '127.0.0.1'
const postgresUrl = process.env.POSTGRES_URL?.trim()
const dataDirectory =
  action === 'build' ? 'memory://' : (process.env.PGLITE_DATA_DIR ?? './pgdata')

const database = postgresUrl ? undefined : await PGlite.create(dataDirectory)
const server = database
  ? new PGLiteSocketServer({
      db: database,
      host,
      port: configuredPort,
      maxConnections: 20,
    })
  : undefined

await server?.start()

const databaseUrl =
  postgresUrl ??
  `postgresql://postgres:postgres@${host}:${configuredPort}/postgres`
const script = `${action}:run`
const packageManager = process.env.npm_execpath
const command = packageManager ? process.execPath : 'pnpm'
const args = packageManager ? [packageManager, script] : [script]
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
  await server?.stop()
  await database?.close()
}

process.exitCode = exitCode
