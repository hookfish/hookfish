import { describe, expect, it, vi } from 'vitest'
import { NotionProvider } from '../src'

describe('NotionProvider', () => {
  it('uses the Notion SDK and validates its response with Zod', async () => {
    const token = vi.fn(async () => ({
      access_token: 'notion-token',
      token_type: 'bearer',
      refresh_token: null,
      workspace_id: 'workspace-id',
      workspace_name: null,
    }))
    const provider = new NotionProvider({
      clientId: 'notion-client',
      clientSecret: 'secret',
      client: { oauth: { token } },
    })
    const result = await provider.exchangeCode({
      code: 'code',
      redirectUri: 'https://broker.example/callback',
    })

    expect(token).toHaveBeenCalledWith({
      client_id: 'notion-client',
      client_secret: 'secret',
      grant_type: 'authorization_code',
      code: 'code',
      redirect_uri: 'https://broker.example/callback',
    })
    expect(result.payload.access_token).toBe('notion-token')
    expect(result.account).toEqual({
      id: 'workspace-id',
      label: undefined,
    })
  })
})
