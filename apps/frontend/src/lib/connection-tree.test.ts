import { describe, expect, it } from 'vitest'
import type { Connection } from './connection-tree'
import {
  connectionDirectory,
  joinConnectionPath,
  validateConnectionName,
  validateConnectionPath,
} from './connection-tree'

function connection(connectionId: string, provider = 'github'): Connection {
  return {
    connection_id: connectionId,
    provider,
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
  it('groups descendants into folders and direct connections', () => {
    const directory = connectionDirectory(
      [
        connection('team/payments/production'),
        connection('team/payments/staging'),
        connection('team/support'),
        connection('personal'),
      ],
      'team',
    )

    expect(directory.folders).toEqual([
      {
        name: 'payments',
        path: 'team/payments',
        connectionCount: 2,
      },
    ])
    expect(directory.connections.map((item) => item.connection_id)).toEqual([
      'team/support',
    ])
  })

  it('builds named connection ids under the current path', () => {
    expect(joinConnectionPath('', 'production')).toBe('production')
    expect(joinConnectionPath('team/payments', 'production')).toBe(
      'team/payments/production',
    )
    expect(validateConnectionName('production-github')).toBeUndefined()
    expect(validateConnectionName('nested/name')).toContain('letters')
    expect(validateConnectionPath('team/payments')).toBeUndefined()
    expect(validateConnectionPath('/team')).toContain('slashes')
  })

  it('keeps empty local folders visible beside connection-backed folders', () => {
    const directory = connectionDirectory(
      [connection('team/payments/production')],
      'team',
      ['team/empty', 'team/payments', 'elsewhere'],
    )

    expect(directory.folders).toEqual([
      { name: 'empty', path: 'team/empty', connectionCount: 0 },
      { name: 'payments', path: 'team/payments', connectionCount: 1 },
    ])
  })
})
