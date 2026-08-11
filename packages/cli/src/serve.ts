/**
 * Forward an API request without consuming redirects. OAuth callbacks must
 * return their 302 to the browser so its address moves off the callback route.
 */
export function proxyBackendRequest(
  request: Request,
  target: URL,
): Promise<Response> {
  return fetch(new Request(target, request), { redirect: 'manual' })
}
