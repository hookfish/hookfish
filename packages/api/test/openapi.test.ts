import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createHookfishOpenAPIDocument } from '../src'

const record = z.record(z.string(), z.unknown())

describe('canonical Hookfish OpenAPI document', () => {
  it('includes stable global and organization SDK operations', async () => {
    const document = record.parse(await createHookfishOpenAPIDocument())
    const paths = record.parse(document.paths)

    const globalAccess = record.parse(
      paths['/connections/access/{connection_path}'],
    )
    expect(record.parse(globalAccess.post).operationId).toBe(
      'connections.access',
    )

    const organizationAccess = record.parse(
      paths[
        '/organization/{organization}/connections/access/{connection_path}'
      ],
    )
    expect(record.parse(organizationAccess.post).operationId).toBe(
      'organization.connections.access',
    )
    expect(organizationAccess.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          in: 'path',
          name: 'organization',
          required: true,
        }),
      ]),
    )

    expect(paths).toHaveProperty('/connections/secret/{connection_path}')
    expect(paths).toHaveProperty('/connections/authorize/{connection_path}')
    expect(paths).toHaveProperty('/connections/callback/{provider_id}')
    expect(paths).toHaveProperty('/connections/client-metadata.json')
    expect(paths).not.toHaveProperty(
      '/organization/{organization}/connections/callback/{provider_id}',
    )
    expect(paths).not.toHaveProperty(
      '/organization/{organization}/connections/client-metadata.json',
    )
  })
})
