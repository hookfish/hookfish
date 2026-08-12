import { getRequestListener } from '@hono/node-server'
import { Hookfish } from '@hookfish/api'
import express from 'express'
import config from '../hookfish.config'

const hookfish = await Hookfish.init(config)
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
