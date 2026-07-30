#!/usr/bin/env node
/**
 * Deploy a Worker without committing anything account-specific.
 *
 * Wrangler does not interpolate environment variables inside its config file,
 * and `wrangler deploy` has no flag for a Hyperdrive binding. So the merge
 * happens here: read the committed config, layer on the private bits, write the
 * result to a gitignored sibling file, and hand that to `wrangler deploy`.
 *
 * The two .env layers mean different things, and the difference matters:
 *
 *   <repo>/.env  deploy-time settings, never uploaded anywhere
 *                  HYPERDRIVE_ID  Hyperdrive config id, bound as HYPERDRIVE
 *                  WORKER_NAME    overrides the Worker name
 *
 *   <app>/.env   the Worker's runtime secrets, uploaded with the version via
 *                --secrets-file (additively -- omitted keys are left alone).
 *                Set SKIP_SECRET_UPLOAD=1 to ship code without touching them.
 *
 * Real environment variables beat both, so CI supplies the same names as
 * repository secrets. With none of them set, the committed config deploys
 * untouched.
 *
 * Usage: wrangler-deploy.mjs <wrangler-config> [extra wrangler args...]
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HYPERDRIVE_BINDING = 'HYPERDRIVE'
const repoRoot = path.resolve(import.meta.dirname, '..')
const appEnvFile = path.join(process.cwd(), '.env')

/** Keys that steer this script. They configure the deploy, not the Worker. */
const DEPLOY_ONLY =
  /^(HYPERDRIVE_ID|WORKER_NAME|SKIP_SECRET_UPLOAD|CLOUDFLARE_\w+)$/

/** The key a .env line assigns, or undefined for blanks and comments. */
function envKey(line) {
  return line.match(/^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=/)?.[1]
}

/** `loadEnvFile` never overwrites a set key, so load most specific first. */
function loadEnv(...files) {
  for (const file of files) {
    try {
      process.loadEnvFile(file)
    } catch {
      // No .env at that layer — the next one (or the real environment) covers it.
    }
  }
}

/** JSON.parse, tolerating the comments and trailing commas wrangler allows. */
function parseJsonc(source) {
  let out = ''

  for (let i = 0; i < source.length; i++) {
    const char = source[i]

    if (char === '"') {
      out += char
      for (i++; i < source.length; i++) {
        out += source[i]
        if (source[i] === '\\') out += source[++i] ?? ''
        else if (source[i] === '"') break
      }
      continue
    }

    if (char === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++
      out += '\n'
      continue
    }

    if (char === '/' && source[i + 1] === '*') {
      for (i += 2; i < source.length; i++) {
        if (source[i] === '*' && source[i + 1] === '/') break
      }
      i++
      continue
    }

    // Trailing comma before the closing brace/bracket it belongs to.
    if (char === '}' || char === ']') out = out.replace(/,\s*$/, '')

    out += char
  }

  return JSON.parse(out)
}

function withHyperdrive(config, id) {
  const others = (config.hyperdrive ?? []).filter(
    (entry) => entry?.binding !== HYPERDRIVE_BINDING,
  )

  return {
    ...config,
    hyperdrive: [...others, { binding: HYPERDRIVE_BINDING, id }],
  }
}

/**
 * The app's .env, minus the keys that only steer this script. Values pass
 * through verbatim so wrangler, not us, decides how to parse them.
 */
function collectSecrets() {
  let source

  try {
    source = readFileSync(appEnvFile, 'utf8')
  } catch {
    return { args: [], cleanup: () => {} }
  }

  const lines = source
    .split('\n')
    .filter((line) => !DEPLOY_ONLY.test(envKey(line) ?? ''))
  const names = lines.map(envKey).filter(Boolean)

  if (names.length === 0) return { args: [], cleanup: () => {} }

  console.log(
    `Uploading ${names.length} secrets from .env: ${names.join(', ')}`,
  )

  const body = lines.join('\n')
  if (body === source)
    return { args: ['--secrets-file', appEnvFile], cleanup: () => {} }

  // Filtered, so wrangler needs a copy. Keep it out of the repo and short-lived.
  const dir = mkdtempSync(path.join(tmpdir(), 'wrangler-secrets-'))
  const file = path.join(dir, '.env')
  writeFileSync(file, body, { mode: 0o600 })

  return {
    args: ['--secrets-file', file],
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

const [, , baseConfigArg, ...forwarded] = process.argv

// `pnpm run deploy -- --dry-run` forwards the `--` too. Wrangler would treat
// everything after it as positional, silently turning --dry-run into a no-op
// and deploying for real, so drop the separator.
const wranglerArgs = forwarded.filter((arg) => arg !== '--')

if (!baseConfigArg) {
  console.error(
    'usage: wrangler-deploy.mjs <wrangler-config> [extra wrangler args...]',
  )
  process.exit(1)
}

loadEnv(path.join(process.cwd(), '.env'), path.join(repoRoot, '.env'))

const hyperdriveId = process.env.HYPERDRIVE_ID?.trim()
const workerName = process.env.WORKER_NAME?.trim()

let configPath = path.resolve(baseConfigArg)

if (hyperdriveId) {
  const merged = withHyperdrive(
    parseJsonc(readFileSync(configPath, 'utf8')),
    hyperdriveId,
  )

  // Sibling of the base config so relative paths (main, assets) still resolve.
  configPath = path.join(path.dirname(configPath), 'wrangler.deploy.json')
  writeFileSync(configPath, `${JSON.stringify(merged, null, 2)}\n`)
  console.log(`Bound ${HYPERDRIVE_BINDING} from HYPERDRIVE_ID.`)
}

const secrets =
  process.env.SKIP_SECRET_UPLOAD === '1'
    ? { args: [], cleanup: () => {} }
    : collectSecrets()

let result

try {
  result = spawnSync(
    'wrangler',
    [
      'deploy',
      '--config',
      configPath,
      ...(workerName ? ['--name', workerName] : []),
      ...secrets.args,
      ...wranglerArgs,
    ],
    { stdio: 'inherit' },
  )
} finally {
  secrets.cleanup()
}

if (result.error) {
  console.error(`Could not run wrangler: ${result.error.message}`)
}

process.exit(result.status ?? 1)
