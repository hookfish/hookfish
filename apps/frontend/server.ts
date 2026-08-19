import { createHookfishClient } from '@hookfish/client'
import type { Register } from '@tanstack/react-router'
import type { RequestHandler } from '@tanstack/react-start/server'
import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import { applicationAuth, handleAuthRequest } from './auth.js'

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

const client = createHookfishClient({
  auth: applicationAuth,
  backendUrl: () => requiredEnvironment('HOOKFISH_BACKEND_URL'),
  apiKey: () => requiredEnvironment('HOOKFISH_API_KEY'),
})
const startFetch = createStartHandler(defaultStreamHandler)

async function proxyBackendRequest(request: Request): Promise<Response> {
  const source = new URL(request.url)
  const target = new URL(
    `${source.pathname}${source.search}`,
    requiredEnvironment('HOOKFISH_BACKEND_URL'),
  )
  const headers = new Headers(request.headers)
  headers.delete('Authorization')
  headers.delete('Cookie')
  const response = await fetch(target, {
    method: request.method,
    headers,
    redirect: 'manual',
    ...(request.method === 'GET' || request.method === 'HEAD'
      ? {}
      : { body: await request.arrayBuffer() }),
  })
  const responseHeaders = new Headers(response.headers)
  responseHeaders.delete('content-encoding')
  responseHeaders.delete('content-length')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

const handleRequest: RequestHandler<Register> = async (request, context) => {
  const pathname = new URL(request.url).pathname
  if (
    pathname.startsWith('/api/connections/callback/') ||
    pathname === '/api/connections/client-metadata.json'
  ) {
    return proxyBackendRequest(request)
  }
  if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) {
    return handleAuthRequest(request)
  }
  if (pathname === '/api/client' || pathname.startsWith('/api/client/')) {
    return client.fetch(request)
  }
  return startFetch(request, context)
}

export default { fetch: handleRequest }
