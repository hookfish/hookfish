import { describe, expect, it } from 'vitest'
import {
  LOCAL_FOLDERS_KEY,
  addLocalFolder,
  normalizeLocalFolders,
  readLocalFolders,
} from './local-folders'

describe('local folders', () => {
  it('adds, deduplicates, and sorts folder paths', () => {
    expect(addLocalFolder(['team/zeta'], 'team', 'alpha')).toEqual([
      'team/alpha',
      'team/zeta',
    ])
    expect(addLocalFolder(['team/alpha'], 'team', 'alpha')).toEqual([
      'team/alpha',
    ])
  })

  it('ignores invalid persisted values', () => {
    expect(
      normalizeLocalFolders(['team/payments', '/invalid', 42, 'team/payments']),
    ).toEqual(['team/payments'])
    expect(
      readLocalFolders({
        getItem(key) {
          expect(key).toBe(LOCAL_FOLDERS_KEY)
          return '{not-json'
        },
      }),
    ).toEqual([])
  })
})
