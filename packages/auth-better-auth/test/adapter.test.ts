import { describe, expect, it, vi } from 'vitest'
import { betterAuth as createBetterAuth } from 'better-auth'
import { organization } from 'better-auth/plugins'
import {
  betterAuth,
  type BetterAuthInstance,
  type BetterAuthSession,
} from '../src'

function instance(
  session: BetterAuthSession | null,
  organizationId?: string,
): BetterAuthInstance<BetterAuthSession> {
  return {
    api: {
      getSession: vi.fn(async () => session),
      getFullOrganization: vi.fn(async () =>
        organizationId
          ? {
              id: organizationId,
              members: [
                { userId: session?.user.id ?? 'unknown', role: 'owner' },
              ],
            }
          : null,
      ),
    },
  }
}

describe('betterAuth', () => {
  it('accepts a real Better Auth instance with the organization plugin', () => {
    const auth = createBetterAuth({
      baseURL: 'https://app.example.com',
      plugins: [organization()],
    })
    expect(betterAuth(auth)).toHaveProperty('authenticate')
  })

  it('returns a currently authorized organization principal', async () => {
    const provider = betterAuth(
      instance(
        { user: { id: 'user-1' }, session: { activeOrganizationId: 'org-1' } },
        'org-1',
      ),
    )
    await expect(
      provider.authenticate(new Request('https://app.example/api/client'), {}),
    ).resolves.toEqual({
      authenticated: true,
      principal: {
        subject: 'user-1',
        tenantId: 'org-1',
        roles: ['owner'],
      },
    })
  })

  it('rejects missing sessions, tenants, and memberships', async () => {
    const unauthenticated = betterAuth(instance(null))
    expect(
      await unauthenticated.authenticate(
        new Request('https://app.example/api/client'),
        {},
      ),
    ).toMatchObject({ authenticated: false, response: { status: 401 } })

    const tenantless = betterAuth(
      instance({ user: { id: 'user-1' }, session: {} }),
    )
    expect(
      await tenantless.authenticate(
        new Request('https://app.example/api/client'),
        {},
      ),
    ).toMatchObject({ authenticated: false, response: { status: 403 } })

    const forbidden = betterAuth(
      instance({
        user: { id: 'user-1' },
        session: { activeOrganizationId: 'org-1' },
      }),
    )
    expect(
      await forbidden.authenticate(
        new Request('https://app.example/api/client'),
        {},
      ),
    ).toMatchObject({ authenticated: false, response: { status: 403 } })
  })

  it('does not turn auth-service failures into authorization decisions', async () => {
    const auth = instance(
      {
        user: { id: 'user-1' },
        session: { activeOrganizationId: 'org-1' },
      },
      'org-1',
    )
    vi.mocked(auth.api.getFullOrganization).mockRejectedValue(
      new Error('database unavailable'),
    )
    expect(
      await betterAuth(auth).authenticate(
        new Request('https://app.example/api/client'),
        {},
      ),
    ).toMatchObject({ authenticated: false, response: { status: 503 } })
  })
})
