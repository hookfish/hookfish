import '@tanstack/react-start/server-only'

const publicOriginVariables = [
  'HOOKFISH_INSPECTOR_URL',
  'PORTLESS_URL',
] as const

function configuredPublicOrigin() {
  for (const variable of publicOriginVariables) {
    const value = process.env[variable]?.trim()
    if (!value) continue

    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new Error(`${variable} must be an absolute HTTP or HTTPS URL.`)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`${variable} must be an absolute HTTP or HTTPS URL.`)
    }
    return url.origin
  }
}

export function inspectorPublicOrigin(requestUrl: string) {
  return configuredPublicOrigin() ?? new URL(requestUrl).origin
}
