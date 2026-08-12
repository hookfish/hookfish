const packageName = 'hookfish'
const latestPackageUrl = `https://registry.npmjs.org/${packageName}/latest`

type ParsedVersion = {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

function parseVersion(version: string): ParsedVersion | undefined {
  const match = version.match(
    /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  )
  if (!match) return undefined

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? [],
  }
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return left.length === right.length ? 0 : left.length === 0 ? 1 : -1
  }

  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index++) {
    const leftPart = left[index]
    const rightPart = right[index]
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1
    }
    if (leftPart === rightPart) continue

    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined
    if (leftNumber !== undefined || rightNumber !== undefined) {
      if (leftNumber === undefined) return 1
      if (rightNumber === undefined) return -1
      return leftNumber < rightNumber ? -1 : 1
    }
    return leftPart < rightPart ? -1 : 1
  }

  return 0
}

export function isOlderVersion(current: string, latest: string): boolean {
  const currentVersion = parseVersion(current)
  const latestVersion = parseVersion(latest)
  if (!currentVersion || !latestVersion) return false

  for (const part of ['major', 'minor', 'patch'] as const) {
    if (currentVersion[part] !== latestVersion[part]) {
      return currentVersion[part] < latestVersion[part]
    }
  }

  return (
    comparePrerelease(currentVersion.prerelease, latestVersion.prerelease) < 0
  )
}

export async function latestVersion(
  fetchLatest: typeof fetch = fetch,
): Promise<string | undefined> {
  try {
    const response = await fetchLatest(latestPackageUrl, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(1_500),
    })
    if (!response.ok) return undefined

    const manifest: unknown = await response.json()
    if (!manifest || typeof manifest !== 'object') return undefined
    const version = Reflect.get(manifest, 'version')
    return typeof version === 'string' ? version : undefined
  } catch {
    return undefined
  }
}

export async function warnIfOutdated(
  currentVersion: string,
  writeWarning: (message: string) => void = (message) =>
    process.stderr.write(message),
  fetchLatest: typeof fetch = fetch,
): Promise<string | undefined> {
  const latest = await latestVersion(fetchLatest)
  if (latest && isOlderVersion(currentVersion, latest)) {
    writeWarning(
      `Warning: Hookfish ${currentVersion} is out of date; the latest version is ${latest}.\nRun \`hookfish update\` to update.\n`,
    )
  }
  return latest
}

export function npmUpdateCommand(): { command: string; args: string[] } {
  return {
    command: 'npm',
    args: ['install', '--global', `${packageName}@latest`],
  }
}
