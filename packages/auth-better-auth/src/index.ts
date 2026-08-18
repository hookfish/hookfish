import type {
  ApplicationAuthProvider,
  ApplicationAuthResult,
} from '@hookfish/client'

export type BetterAuthSession = {
  user: { id: string }
  session: { activeOrganizationId?: string | null }
}

export type BetterAuthOrganization = {
  id: string
  members?: readonly {
    userId?: string
    role?: string
  }[]
}

/** Minimal server API exposed by Better Auth with the organization plugin. */
export type BetterAuthInstance<Session extends BetterAuthSession> = {
  api: {
    getSession(input: { headers: Headers }): Promise<Session | null>
    getFullOrganization(input: {
      headers: Headers
      query: { organizationId: string }
    }): Promise<BetterAuthOrganization | null>
  }
}

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * Adapt a Better Auth server instance with the organization plugin to
 * Hookfish's application authentication contract.
 */
export function betterAuth<
  Bindings extends object = object,
  Session extends BetterAuthSession = BetterAuthSession,
>(auth: BetterAuthInstance<Session>): ApplicationAuthProvider<Bindings> {
  return {
    async authenticate(request): Promise<ApplicationAuthResult> {
      const headers = new Headers(request.headers)
      let session: Session | null
      try {
        session = await auth.api.getSession({ headers })
      } catch {
        return {
          authenticated: false,
          response: errorResponse(
            503,
            'application_auth_unavailable',
            'Application authentication is temporarily unavailable.',
          ),
        }
      }
      if (!session) {
        return {
          authenticated: false,
          response: errorResponse(
            401,
            'application_auth_required',
            'Sign in to access Hookfish connections.',
          ),
        }
      }

      const tenantId = session.session.activeOrganizationId?.trim()
      if (!tenantId) {
        return {
          authenticated: false,
          response: errorResponse(
            403,
            'application_tenant_required',
            'Select an organization before accessing Hookfish connections.',
          ),
        }
      }

      let organization: BetterAuthOrganization | null
      try {
        // Better Auth's organization endpoint performs its own membership
        // check before returning the organization.
        organization = await auth.api.getFullOrganization({
          headers,
          query: { organizationId: tenantId },
        })
      } catch {
        return {
          authenticated: false,
          response: errorResponse(
            503,
            'application_auth_unavailable',
            'Application authentication is temporarily unavailable.',
          ),
        }
      }
      if (!organization || organization.id !== tenantId) {
        return {
          authenticated: false,
          response: errorResponse(
            403,
            'application_tenant_forbidden',
            'The authenticated user is not a member of this organization.',
          ),
        }
      }

      const roles = organization.members
        ?.filter((member) => member.userId === session.user.id)
        .flatMap((member) => (member.role ? [member.role] : []))

      return {
        authenticated: true,
        principal: {
          subject: session.user.id,
          tenantId,
          ...(roles?.length ? { roles } : {}),
        },
      }
    },
  }
}
