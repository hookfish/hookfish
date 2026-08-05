import { requireBrokerApiKey } from '@hookfish/api/oauth/config'
import { getRequest } from '@tanstack/react-start/server'
import {
  type HookfishProxyRequest,
  isAllowedHookfishProxyRequest,
} from './hookfish-proxy'
import { hookfishServer } from './hookfish-server.server'

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}

export async function forwardHookfishProxyRequest(
  request: HookfishProxyRequest,
): Promise<Response> {
  if (!isAllowedHookfishProxyRequest(request)) {
    return errorResponse(
      403,
      'forbidden_proxy_route',
      'This Hookfish route is not available to the browser.',
    )
  }

  const origin = new URL(getRequest().url).origin
  const url = new URL(request.path, origin)
  const headers = new Headers({
    Accept: 'application/json',
    Authorization: `Bearer ${requireBrokerApiKey(process.env)}`,
  })

  if (request.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await hookfishServer.fetch(
    new Request(url, {
      method: request.method,
      headers,
      body: request.body,
    }),
  )
  const responseHeaders = new Headers(response.headers)
  responseHeaders.set('Cache-Control', 'no-store')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}
