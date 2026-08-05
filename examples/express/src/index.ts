import path from 'node:path'
import { getRequestListener } from '@hono/node-server'
import express from 'express'

const packageRoot = path.resolve(import.meta.dirname, '..')
const envPath = path.resolve(packageRoot, '../../apps/frontend/.env')

try {
  process.loadEnvFile(envPath)
  console.log(`Loaded env from ${envPath}`)
} catch {
  console.warn(
    `No .env at ${envPath} -- using the ambient environment only.\n` +
      '  Create it with: cp apps/frontend/.env.example apps/frontend/.env',
  )
}

const { Hookfish } = await import('@hookfish/api')
const { createHookfishBackend } = await import('@hookfish/backend')
const { pglite } = await import('@hookfish/database/pglite')
const { default: config } = await import('../../../hookfish.config')
const db = pglite(
  process.env.PGLITE_DATA_DIR ?? path.resolve(packageRoot, '../../pgdata'),
)
const hookfish = await Hookfish.init(config, { db })
const backend = createHookfishBackend<NodeJS.ProcessEnv>({
  config,
  hookfishFetch: hookfish.fetch,
  runtime: 'express',
})
const handleBackend = getRequestListener((request) =>
  backend.fetch(request, process.env),
)

const app = express()

app.get('/', (_request, response) => {
  response.type('text').send('Hookfish is mounted at /api and /client')
})

app.use((request, response, next) => {
  if (
    request.path === '/api' ||
    request.path.startsWith('/api/') ||
    request.path === '/client' ||
    request.path.startsWith('/client/')
  ) {
    void handleBackend(request, response).catch(next)
    return
  }

  next()
})

const port = Number(
  process.env.HOOKFISH_BACKEND_PORT ?? process.env.PORT ?? 3000,
)
const hostname = process.env.HOST ?? '127.0.0.1'

app.listen(port, hostname, () => {
  console.log(`Express server on http://${hostname}:${port}`)
  console.log(`Hookfish API on http://${hostname}:${port}/api`)
  console.log(`Browser API on http://${hostname}:${port}/client`)
})
