const allowedMethods = ['GET', 'POST', 'DELETE'] as const
type AllowedMethod = (typeof allowedMethods)[number]

function parseMethod(method: string): AllowedMethod | undefined {
  const normalized = method.toUpperCase()
  return allowedMethods.find((candidate) => candidate === normalized)
}

/** Whether an API operation is safe for the credential-injecting client facade. */
export function isAllowedClientRequest(
  method: string,
  pathname: string,
): boolean {
  const normalizedMethod = parseMethod(method)
  if (!normalizedMethod) return false

  let decodedPathname: string
  try {
    decodedPathname = decodeURIComponent(pathname)
  } catch {
    return false
  }

  if (normalizedMethod === 'GET') {
    return (
      decodedPathname === '/api/stats' ||
      decodedPathname === '/api/oauth/providers' ||
      decodedPathname === '/api/oauth/connections' ||
      decodedPathname.startsWith('/api/oauth/connections/')
    )
  }

  if (normalizedMethod === 'POST') {
    return /^\/api\/oauth\/[^/]+\/authorize$/.test(decodedPathname)
  }

  return (
    decodedPathname.startsWith('/api/oauth/connections/') &&
    decodedPathname.length > '/api/oauth/connections/'.length
  )
}
