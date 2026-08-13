import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createHookfishOpenAPIDocument } from '../src'

const record = z.record(z.string(), z.unknown())

describe('canonical Hookfish OpenAPI document', () => {
  it('includes the stable SDK operations', async () => {
    const document = record.parse(await createHookfishOpenAPIDocument())
    const paths = record.parse(document.paths)

    const globalAccess = record.parse(
      paths['/connections/access/{connection_path}'],
    )
    expect(record.parse(globalAccess.post).operationId).toBe(
      'connections.access',
    )

    expect(paths).toHaveProperty('/connections/secret/{connection_path}')
    expect(paths).toHaveProperty('/connections/authorize/{connection_path}')
    expect(paths).toHaveProperty('/connections/callback/{provider_id}')
    expect(paths).toHaveProperty('/connections/client-metadata.json')
    expect(Object.keys(paths)).not.toEqual(
      expect.arrayContaining([expect.stringContaining('/organization/')]),
    )
  })
})
