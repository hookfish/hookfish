import { spawnSync } from 'node:child_process'

export function gitOutput(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

export function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function getPortlessRoute(appName) {
  const branch = slug(gitOutput(['branch', '--show-current']))
  const branchPrefix =
    branch && !['main', 'master'].includes(branch) ? branch : ''
  const name = branchPrefix ? `${branchPrefix}.${appName}` : appName

  return {
    routeName: name,
    url: `https://${name}.localhost`,
    serverUrl: `https://${branchPrefix ? `${branchPrefix}.` : ''}server.localhost`,
  }
}
