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

const { default: hookfish } = await import('../../../hookfish.config')
const handleHookfish = getRequestListener((request) =>
  hookfish.fetch(request, process.env),
)

const app = express()

app.get('/', (_request, response) => {
  response.type('text').send('Hookfish is mounted at /api')
})

app.use((request, response, next) => {
  if (request.path === '/api' || request.path.startsWith('/api/')) {
    void handleHookfish(request, response).catch(next)
    return
  }

  next()
})

const port = Number(process.env.PORT ?? 3000)
const hostname = process.env.HOST ?? '127.0.0.1'

app.listen(port, hostname, () => {
  console.log(`Express server on http://${hostname}:${port}`)
  console.log(`Hookfish API on http://${hostname}:${port}/api`)
})
