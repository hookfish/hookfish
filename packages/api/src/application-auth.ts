import { BrokerError } from './oauth/errors.js'
import {
  MAX_RESOURCE_PATH_LENGTH,
  normalizeResourcePath,
} from './oauth/resource-path.js'

export type ApplicationPrincipal = {
  /** Stable application user identifier used in audit events. */
  subject: string
  /** Stable, currently authorized tenant identifier. */
  tenantId: string
  /** Optional application roles for audit and custom authorization. */
  roles?: readonly string[]
}

export type ApplicationAuthResult =
  | { authenticated: true; principal: ApplicationPrincipal }
  | { authenticated: false; response: Response }

/**
 * Authenticates an application request and asserts the tenant the subject may
 * currently act within. Implementations must not trust an unverified tenant id
 * supplied by the browser.
 */
export interface ApplicationAuthProvider<Bindings extends object = object> {
  authenticate(
    request: Request,
    bindings: Bindings | undefined,
  ): ApplicationAuthResult | Promise<ApplicationAuthResult>
}

const applicationTenantRoot = '__hookfish_application'

function toBase64Url(value: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(value)) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function normalizeApplicationPrincipal(
  principal: ApplicationPrincipal,
): ApplicationPrincipal {
  const subject = principal.subject.trim()
  const tenantId = principal.tenantId.trim()
  if (!subject || subject.length > 512) {
    throw new BrokerError(
      403,
      'invalid_application_subject',
      'The application auth provider returned an invalid subject.',
    )
  }
  if (!tenantId || tenantId.length > 512) {
    throw new BrokerError(
      403,
      'invalid_application_tenant',
      'The application auth provider returned an invalid tenant.',
    )
  }
  return { ...principal, subject, tenantId }
}

/** Internal namespace used to keep application tenants disjoint. */
export function applicationTenantNamespace(tenantId: string): string {
  const namespace = `${applicationTenantRoot}/${toBase64Url(tenantId)}`
  if (namespace.length > MAX_RESOURCE_PATH_LENGTH - 130) {
    throw new BrokerError(
      403,
      'invalid_application_tenant',
      'The application tenant identifier is too long.',
    )
  }
  return normalizeResourcePath(namespace, 'namespace')
}

export function applicationTenantScope(tenantId: string): string {
  return `${applicationTenantNamespace(tenantId)}/**`
}

export function qualifyApplicationPath(
  tenantId: string,
  relativePath: string,
): string {
  const relative = normalizeResourcePath(relativePath, 'connection')
  return normalizeResourcePath(
    `${applicationTenantNamespace(tenantId)}/${relative}`,
    'connection',
  )
}

export function qualifyApplicationNamespace(
  tenantId: string,
  relativeNamespace: string,
): string {
  if (!relativeNamespace) return applicationTenantNamespace(tenantId)
  return normalizeResourcePath(
    `${applicationTenantNamespace(tenantId)}/${normalizeResourcePath(relativeNamespace, 'namespace')}`,
    'namespace',
  )
}

export function stripApplicationNamespace(
  tenantId: string,
  value: string,
): string | undefined {
  const namespace = applicationTenantNamespace(tenantId)
  if (value === namespace) return ''
  const prefix = `${namespace}/`
  return value.startsWith(prefix) ? value.slice(prefix.length) : undefined
}

/** Strip Hookfish's reserved application namespace for OAuth redirects. */
export function stripAnyApplicationNamespace(value: string): string {
  const segments = value.split('/')
  return segments[0] === applicationTenantRoot && segments.length > 2
    ? segments.slice(2).join('/')
    : value
}
