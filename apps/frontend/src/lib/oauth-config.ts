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
    const segments = url.pathname.split('/')
    if (segments.at(-1) !== 'callback' || segments.length < 2) return ''

    segments[segments.length - 2] = providerId
    url.pathname = segments.join('/')
    return url.toString()
  } catch {
    return ''
  }
}
