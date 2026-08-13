import { describe, expect, it } from 'vitest'
import { connectionDirectory, validateConnectionPath } from './connection-tree'

type Connection = Parameters<typeof connectionDirectory>[0][number]

function connection(path: string, providerId = 'github'): Connection {
  const separator = path.lastIndexOf('/')
  return {
    path,
    namespace: path.slice(0, separator),
    provider_id: providerId,
    configuration: {},
    scopes: [],
    expires_at: null,
    external_account_id: null,
    external_account_label: null,
    metadata: {},
    created_at: '2026-08-04T00:00:00.000Z',
    updated_at: '2026-08-04T00:00:00.000Z',
  }
}

describe('connection tree', () => {
  it('accepts nested resource names as connection paths', () => {
    expect(validateConnectionPath('team/production/notion')).toBeUndefined()
    expect(validateConnectionPath('team//notion')).toBeDefined()
  })

  it('groups descendants into folders and direct connections', () => {
    const directory = connectionDirectory(
      [
        connection('team/payments/production'),
        connection('team/payments/staging'),
        connection('team/support'),
        connection('personal/github'),
      ],
      'team',
    )

    expect(directory.folders).toEqual([
      {
        name: 'payments',
        path: 'team/payments',
        itemCount: 2,
      },
    ])
    expect(directory.connections.map((item) => item.path)).toEqual([
      'team/support',
    ])
  })

  it('includes empty local folders and folders implied by other resources', () => {
    const directory = connectionDirectory(
      [connection('team/accounts/github')],
      'team',
      ['team/empty'],
      ['team/secrets/openai'],
    )

    expect(directory.folders).toEqual([
      { name: 'accounts', path: 'team/accounts', itemCount: 1 },
      { name: 'empty', path: 'team/empty', itemCount: 0 },
      { name: 'secrets', path: 'team/secrets', itemCount: 1 },
    ])
  })
})
