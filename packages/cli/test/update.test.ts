import { describe, expect, it, vi } from 'vitest'
import {
  isOlderVersion,
  latestVersion,
  npmUpdateCommand,
  warnIfOutdated,
} from '../src/update'

describe('isOlderVersion', () => {
  it.each([
    ['0.8.4', '0.8.5'],
    ['0.8.4', '0.9.0'],
    ['0.8.4', '1.0.0'],
    ['1.0.0-beta.1', '1.0.0-beta.2'],
    ['1.0.0-beta.2', '1.0.0'],
  ])('recognizes that %s is older than %s', (current, latest) => {
    expect(isOlderVersion(current, latest)).toBe(true)
  })

  it.each([
    ['0.8.4', '0.8.4'],
    ['0.9.0', '0.8.4'],
    ['1.0.0', '1.0.0-beta.2'],
    ['development', '1.0.0'],
  ])('does not treat %s as older than %s', (current, latest) => {
    expect(isOlderVersion(current, latest)).toBe(false)
  })
})

describe('latestVersion', () => {
  it('reads the latest version from the npm registry', async () => {
    const fetchLatest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ version: '1.2.3' }))

    await expect(latestVersion(fetchLatest)).resolves.toBe('1.2.3')
    expect(fetchLatest).toHaveBeenCalledWith(
      'https://registry.npmjs.org/hookfish/latest',
      expect.objectContaining({
        headers: { accept: 'application/json' },
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('silently ignores registry failures', async () => {
    const fetchLatest = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('offline'))

    await expect(latestVersion(fetchLatest)).resolves.toBeUndefined()
  })
})

describe('warnIfOutdated', () => {
  it('tells users how to update an old installation', async () => {
    const writeWarning = vi.fn()
    const fetchLatest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ version: '0.9.0' }))

    await warnIfOutdated('0.8.4', writeWarning, fetchLatest)

    expect(writeWarning).toHaveBeenCalledWith(
      'Warning: Hookfish 0.8.4 is out of date; the latest version is 0.9.0.\nRun `hookfish update` to update.\n',
    )
  })

  it('does not warn when the installed version is current', async () => {
    const writeWarning = vi.fn()
    const fetchLatest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ version: '0.8.4' }))

    await warnIfOutdated('0.8.4', writeWarning, fetchLatest)

    expect(writeWarning).not.toHaveBeenCalled()
  })
})

describe('npmUpdateCommand', () => {
  it('installs the latest Hookfish release globally', () => {
    expect(npmUpdateCommand()).toEqual({
      command: 'npm',
      args: ['install', '--global', 'hookfish@latest'],
    })
  })
})
