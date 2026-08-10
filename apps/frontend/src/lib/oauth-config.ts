export function defaultOAuthConfigId(
  templateId: string,
  existingIds: readonly string[],
): string {
  const base = `${templateId || 'oauth'}-custom`
  const existing = new Set(existingIds)
  if (!existing.has(base)) return base

  let suffix = 2
  while (existing.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

export function oauthRedirectUri(
  templateCallbackUrl: string | undefined,
  providerId: string,
): string {
  if (!templateCallbackUrl || !providerId) return ''

  try {
    const url = new URL(templateCallbackUrl)
    const marker = '/oauth/callback/'
    const markerIndex = url.pathname.indexOf(marker)
    if (markerIndex < 0) return ''

    const encodedPath = providerId.split('/').map(encodeURIComponent).join('/')
    url.pathname = `${url.pathname.slice(0, markerIndex + marker.length)}${encodedPath}`
    return url.toString()
  } catch {
    return ''
  }
}
