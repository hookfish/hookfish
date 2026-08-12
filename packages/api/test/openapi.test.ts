import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createHookfishOpenAPIDocument } from '../src'

const record = z.record(z.string(), z.unknown())

describe('canonical Hookfish OpenAPI document', () => {
  it('includes stable global and organization SDK operations', async () => {
    const document = record.parse(await createHookfishOpenAPIDocument())
    const paths = record.parse(document.paths)

    const globalToken = record.parse(paths['/oauth/tokens/{connection_id}'])
    expect(record.parse(globalToken.get).operationId).toBe('oauth.tokens.get')

    const organizationToken = record.parse(
      paths['/organization/{organization}/oauth/tokens/{connection_id}'],
    )
    expect(record.parse(organizationToken.get).operationId).toBe(
      'organization.oauth.tokens.get',
    )
    expect(organizationToken.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          in: 'path',
          name: 'organization',
          required: true,
        }),
      ]),
    )

    expect(paths).toHaveProperty('/admin/providers/{provider_path}')
    expect(paths).toHaveProperty(
      '/organization/{organization}/admin/providers/{provider_path}',
    )
    expect(paths).not.toHaveProperty(
      '/organization/{organization}/oauth/callback/{provider_path}',
    )
    expect(paths).not.toHaveProperty(
      '/organization/{organization}/oauth/client-metadata/{provider_path}',
    )
  })
})
