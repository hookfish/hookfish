export const defaultFrontendHostname = 'localhost'

export function resolveBackendUrl(
  configuredBackendUrl: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const backendUrl =
    configuredBackendUrl?.trim() || environment.HOOKFISH_BACKEND_URL?.trim()
  if (!backendUrl) {
    throw new Error(
      '--backend-url or HOOKFISH_BACKEND_URL is required to serve the dashboard.',
    )
  }

  const parsedBackendUrl = new URL(backendUrl)
  if (!['http:', 'https:'].includes(parsedBackendUrl.protocol)) {
    throw new Error('--backend-url must use http or https.')
  }

  return backendUrl
}

/**
 * Forward an API request without consuming redirects. OAuth callbacks must
 * return their 302 to the browser so its address moves off the callback route.
 */
export async function proxyBackendRequest(
  request: Request,
  target: URL,
): Promise<Response> {
  const response = await fetch(new Request(target, request), {
    redirect: 'manual',
  })
  const headers = new Headers(response.headers)

  // Node's fetch transparently decompresses response bodies but retains the
  // backend's compression and byte-length headers. Forwarding those headers
  // makes browsers try to decompress an already-decoded body, which surfaces
  // as a generic `Failed to fetch` error.
  headers.delete('content-encoding')
  headers.delete('content-length')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
