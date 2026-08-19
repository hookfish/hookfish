import { normalizeResourcePath } from '@hookfish/api/capabilities'

export type ApplicationPrincipal = {
  /** Stable application user identifier used in audit events. */
  subject: string
  /** Canonical subtree, or null to retain the configured API token's grant. */
  basePath: string | null
  /** Optional application roles for audit and host policy. */
  roles?: readonly string[]
}

export type ApplicationAuthResult =
  | { authenticated: true; principal: ApplicationPrincipal }
  | { authenticated: false; response: Response }

export interface ApplicationAuthProvider<Bindings extends object = object> {
  authenticate(
    request: Request,
    bindings: Bindings | undefined,
  ): ApplicationAuthResult | Promise<ApplicationAuthResult>
}

export function normalizeApplicationPrincipal(
  principal: ApplicationPrincipal,
): ApplicationPrincipal {
  const subject = principal.subject.trim()
  if (!subject || subject.length > 512) {
    throw new Error(
      'The application auth provider returned an invalid subject.',
    )
  }
  const basePath =
    principal.basePath === null
      ? null
      : normalizeResourcePath(principal.basePath.trim(), 'base')
  return { ...principal, subject, basePath }
}

export function applicationScope(basePath: string): string {
  return `${normalizeResourcePath(basePath, 'base')}/**`
}

export function pathIsWithinBase(basePath: string, path: string): boolean {
  const normalizedBase = normalizeResourcePath(basePath, 'base')
  const normalizedPath = normalizeResourcePath(path, 'resource')
  return (
    normalizedPath === normalizedBase ||
    normalizedPath.startsWith(`${normalizedBase}/`)
  )
}
