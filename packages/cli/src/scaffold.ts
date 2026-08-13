import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { defaultFrontendHostname } from './serve.js'

export const scaffoldBackends = [
  'vercel',
  'cloudflare',
  'node',
  'bun',
  'docker',
] as const

export type ScaffoldBackend = (typeof scaffoldBackends)[number]

export type ScaffoldOptions = {
  name: string
  backend: ScaffoldBackend
  parentDirectory?: string
  dependencyTag?: string
}

export type ScaffoldResult = {
  directory: string
  files: string[]
}

function commonDependencies(dependencyTag: string): Record<string, string> {
  return {
    '@hookfish/api': dependencyTag,
    '@hookfish/database': dependencyTag,
    '@hookfish/providers': dependencyTag,
  }
}

function commonDevDependencies(dependencyTag: string): Record<string, string> {
  return {
    hookfish: dependencyTag,
    typescript: '~5.9.3',
  }
}

export function dependencyTagForVersion(version: string): string {
  return (
    version.match(/^\d+\.\d+\.\d+-([a-z][a-z\d]*)(?:[.-]|$)/i)?.[1] ?? 'latest'
  )
}

const gitignore = `node_modules
.env
.dev.vars
.vercel
.wrangler
.turbo
dist
data
pgdata
*.log
`

const environmentExample = `# Copy to .env (or .dev.vars on Cloudflare) for local development.
# Never commit the copied file.
# Generate with: openssl rand -base64 32
OAUTH_ENCRYPTION_KEY=
HOOKFISH_API_KEY=

# Required for the Vercel backend. Other backends ignore this by default.
DATABASE_URL=

# Production callback origin, for example https://broker.example.com.
# OAUTH_REDIRECT_BASE_URL=

# Origin where the dashboard is hosted in production.
# HOOKFISH_FRONTEND_URL=https://dashboard.example.com
`

const cloudflareEnvironmentExample = environmentExample.replace(
  `# Required for the Vercel backend. Other backends ignore this by default.
DATABASE_URL=

`,
  '',
)

const cloudflareMigrationEnvironment = `# Direct PostgreSQL connection used only by \`pnpm migrate\`.
# The Worker connects through Hyperdrive instead. Never commit this file.
DATABASE_URL=
`

function localEnvironment(template = environmentExample): string {
  return template
    .replace(
      'OAUTH_ENCRYPTION_KEY=',
      `OAUTH_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,
    )
    .replace(
      'HOOKFISH_API_KEY=',
      `HOOKFISH_API_KEY=${randomBytes(32).toString('base64')}`,
    )
}

const tsconfig = `{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strictNullChecks": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "hookfish.config.ts"]
}
`

const providerConfig = `providers: {
    mcp: createMcpProvider(),
    secret: createSecretProvider(),
  }`

function pgliteConfig(): string {
  return `import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { defineHookfishConfig } from '@hookfish/api'
import { pglite } from '@hookfish/database/pglite'
import {
  createMcpProvider,
  createSecretProvider,
} from '@hookfish/providers'

const frontendUrl = process.env.HOOKFISH_FRONTEND_URL ?? 'http://127.0.0.1:5173'
const dataDir = process.env.PGLITE_DATA_DIR ?? path.resolve('data/hookfish')
// PGlite creates its database directory, but its parent must already exist.
if (!/^[a-z][a-z\\d+.-]*:\\/\\//i.test(dataDir)) {
  mkdirSync(path.dirname(path.resolve(dataDir)), { recursive: true })
}

export default defineHookfishConfig({
  db: pglite(dataDir),
  includeClient: true,
  includeSwagger: true,
  returnTo: frontendUrl,
  trustedOrigins: [frontendUrl],
  ${providerConfig},
})
`
}

function postgresConfig(): string {
  return `import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { defineHookfishConfig } from '@hookfish/api'
import { pglite } from '@hookfish/database/pglite'
import { postgres } from '@hookfish/database/postgres'
import {
  createMcpProvider,
  createSecretProvider,
} from '@hookfish/providers'

const frontendUrl = process.env.HOOKFISH_FRONTEND_URL ?? 'http://127.0.0.1:5173'
const databaseUrl = process.env.DATABASE_URL
const dataDir = process.env.PGLITE_DATA_DIR ?? path.resolve('data/hookfish')
// PGlite creates its database directory, but its parent must already exist.
if (!databaseUrl && !/^[a-z][a-z\\d+.-]*:\\/\\//i.test(dataDir)) {
  mkdirSync(path.dirname(path.resolve(dataDir)), { recursive: true })
}
if (
  process.env.VERCEL_ENV &&
  process.env.VERCEL_ENV !== 'development' &&
  !databaseUrl
) {
  throw new Error('DATABASE_URL is required for Vercel preview and production deployments.')
}

export default defineHookfishConfig({
  db: databaseUrl
    ? postgres(databaseUrl)
    : pglite(dataDir),
  includeClient: true,
  includeSwagger: true,
  returnTo: frontendUrl,
  trustedOrigins: [frontendUrl],
  ${providerConfig},
})
`
}

const nodeServer = `import { serve } from '@hono/node-server'
import { HookfishServer } from '@hookfish/api'
import config from '../hookfish.config'

const hookfish = await HookfishServer.init(config)
const port = Number(process.env.PORT ?? 8787)
const hostname = process.env.HOST ?? '127.0.0.1'

serve({
  fetch: (request) => hookfish.fetch(request, process.env),
  hostname,
  port,
})

console.log(\`Hookfish backend running at http://\${hostname}:\${port}/api/docs\`)
`

const bunServer = `import { HookfishServer } from '@hookfish/api'
import config from '../hookfish.config'

const hookfish = await HookfishServer.init(config)
const port = Number(process.env.PORT ?? 8787)
const hostname = process.env.HOST ?? '127.0.0.1'

Bun.serve({
  fetch: (request) => hookfish.fetch(request, process.env),
  hostname,
  port,
})

console.log(\`Hookfish backend running at http://\${hostname}:\${port}/api/docs\`)
`

const vercelServer = `import { HookfishServer } from '@hookfish/api'
import { Hono } from 'hono'
import config from '../hookfish.config'

const hookfish = await HookfishServer.init(config)
const app = new Hono()

app.all('*', (context) => hookfish.fetch(context.req.raw, process.env))

export default app
`

const cloudflareServer = `import { HookfishServer } from '@hookfish/api'
import { postgres } from '@hookfish/database/postgres'
import {
  createMcpProvider,
  createSecretProvider,
} from '@hookfish/providers'

// Hyperdrive manages the connection pool. Disable Hookfish's client cache so
// every Worker request gets a request-scoped client backed by that pool.
const db = postgres<Env>(
  (bindings) => bindings.HYPERDRIVE.connectionString,
  {
    cache: false,
    fetchTypes: false,
    max: 5,
    prepare: true,
  },
)
const frontendUrl = process.env.HOOKFISH_FRONTEND_URL ?? 'http://127.0.0.1:5173'
const hookfish = await HookfishServer.init<Env>({
  db,
  includeClient: true,
  includeSwagger: true,
  returnTo: frontendUrl,
  trustedOrigins: [frontendUrl],
  providers: {
    mcp: createMcpProvider(),
    secret: createSecretProvider(),
  },
})

export default {
  fetch(request, env, context) {
    return hookfish.fetch(request, env, context)
  },
} satisfies ExportedHandler<Env>
`

const cloudflareMigration = `import { migrateDatabase } from '@hookfish/database'
import { postgres } from '@hookfish/database/postgres'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is required to run PostgreSQL migrations.')
}

await migrateDatabase(postgres(connectionString), process.env)
console.log('Hookfish PostgreSQL migrations completed.')
`

function packageJson(
  name: string,
  backend: ScaffoldBackend,
  dependencyTag: string,
): Record<string, unknown> {
  const scripts: Record<string, string> = {
    dev: `concurrently --kill-others-on-fail "npm:dev:server" "hookfish serve --backend-url http://127.0.0.1:\${HOOKFISH_BACKEND_PORT:-$(( \${CONDUCTOR_PORT:-8786} + 1 ))}"`,
    typecheck: 'tsc --noEmit',
  }
  const dependencies = commonDependencies(dependencyTag)
  const devDependencies = commonDevDependencies(dependencyTag)
  devDependencies.concurrently = '^9.2.1'

  const backendPort = `\${HOOKFISH_BACKEND_PORT:-$(( \${CONDUCTOR_PORT:-8786} + 1 ))}`
  const frontendOrigin = `\${HOOKFISH_FRONTEND_URL:-http://${defaultFrontendHostname}:\${FRONTEND_PORT:-\${CONDUCTOR_PORT:-5173}}}`
  const serverEnvironment = `HOOKFISH_FRONTEND_URL=${frontendOrigin} OAUTH_REDIRECT_BASE_URL=\${OAUTH_REDIRECT_BASE_URL:-${frontendOrigin}}`

  switch (backend) {
    case 'node':
      scripts['dev:server'] =
        `${serverEnvironment} PORT=${backendPort} node --env-file=.env --watch --import tsx src/index.ts`
      dependencies['@hono/node-server'] = '^2.0.12'
      devDependencies['@types/node'] = '^24.12.3'
      devDependencies.tsx = '^4.23.1'
      break
    case 'bun':
      scripts['dev:server'] =
        `${serverEnvironment} PORT=${backendPort} bun --watch src/index.ts`
      devDependencies['@types/bun'] = 'latest'
      devDependencies['@types/node'] = '^24.12.3'
      break
    case 'vercel':
      scripts['dev:server'] =
        `${serverEnvironment} vercel dev --listen \${HOST:-127.0.0.1}:${backendPort}`
      scripts.deploy = 'vercel deploy'
      dependencies.hono = '^4.12.34'
      devDependencies['@types/node'] = '^24.12.3'
      devDependencies.vercel = 'latest'
      break
    case 'cloudflare':
      scripts['dev:server'] =
        `wrangler dev --port ${backendPort} --var HOOKFISH_FRONTEND_URL:${frontendOrigin} --var OAUTH_REDIRECT_BASE_URL:\${OAUTH_REDIRECT_BASE_URL:-${frontendOrigin}}`
      scripts.typegen = 'wrangler types --env-file wrangler-typegen.env'
      scripts.typecheck =
        'wrangler types --env-file wrangler-typegen.env && tsc --noEmit'
      scripts.deploy = 'wrangler deploy'
      scripts.migrate = 'node --env-file=.env --import tsx src/migrate.ts'
      devDependencies['@types/node'] = '^24.12.3'
      devDependencies.tsx = '^4.23.1'
      devDependencies.wrangler = '^4.118.0'
      break
    case 'docker':
      scripts['dev:server'] =
        `${serverEnvironment} PORT=${backendPort} docker compose up --build`
      scripts.deploy = 'docker compose up --build -d'
      dependencies['@hono/node-server'] = '^2.0.12'
      dependencies.tsx = '^4.23.1'
      devDependencies['@types/node'] = '^24.12.3'
      break
  }

  return {
    name,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts,
    dependencies,
    devDependencies,
  }
}

function cloudflareTsconfig(): string {
  return `{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strictNullChecks": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "worker-configuration.d.ts"]
}
`
}

function cloudflareWranglerConfig(name: string): string {
  return `{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": ${JSON.stringify(name)},
  "main": "./src/index.ts",
  "compatibility_date": "2026-08-11",
  "compatibility_flags": ["nodejs_compat"],
  "observability": {
    "enabled": true
  },

  // Hyperdrive setup:
  // 1. Create a PostgreSQL database and a Hyperdrive configuration for it.
  // 2. Replace the placeholder ID below with the Hyperdrive configuration ID.
  // 3. For local development, export
  //    CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE with the
  //    direct PostgreSQL URL before running \`pnpm dev\`.
  // 4. Put the direct PostgreSQL URL in .env and run \`pnpm migrate\` before
  //    starting the Worker or deploying it.
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "<YOUR_HYPERDRIVE_ID>"
    }
  ]
}
`
}

function readme(name: string, backend: ScaffoldBackend): string {
  const localEnvironmentFile = backend === 'cloudflare' ? '.dev.vars' : '.env'
  const production =
    backend === 'cloudflare'
      ? `Create a PostgreSQL database and a Hyperdrive configuration, then follow the setup comments in \`wrangler.jsonc\`. Put the direct PostgreSQL URL in \`.env\`, run \`pnpm migrate\`, store production values with \`wrangler secret put <NAME>\`, and run \`pnpm deploy\`.`
      : backend === 'vercel'
        ? `Set the variables from \`.env.example\` in Vercel, then run \`pnpm deploy\`. Vercel uses Postgres through \`DATABASE_URL\`.`
        : backend === 'docker'
          ? `Run \`pnpm deploy\` to start the Compose service in the background. PGlite data is persisted in the \`hookfish-data\` volume.`
          : `Deploy \`src/index.ts\` with a Node-compatible ${backend === 'bun' ? 'Bun' : 'Node.js'} host and set the production environment variables.`

  return `# ${name}

Hookfish broker scaffold for the **${backend}** backend.

## Develop

\`\`\`sh
pnpm install
pnpm dev
# Or run only the backend:
pnpm dev:server
\`\`\`

\`pnpm dev:server\` starts the ${backend} development server directly. \`pnpm dev\` runs that script beside \`hookfish serve --backend-url <backend-url>\`, which serves the packaged dashboard and proxies \`/api\` to the backend so the browser stays same-origin.

A gitignored \`${localEnvironmentFile}\` is generated with unique local encryption and broker API keys. The scaffold enables remote MCP OAuth and supplied-secret connections by default. Add other trusted providers in the Hookfish configuration when needed.

## Deploy

${production}

## Attribution

Hookfish is licensed under the Functional Source License 1.1 with an
attribution requirement: ${licenseUrl}

Ship this as an end-user-facing application and you must credit Hookfish
somewhere users can find it — an about page, a credits or third-party licenses
screen, or a footer. \`AGENTS.md\` carries the same note for coding agents.
`
}

const repositoryUrl = 'https://github.com/hookfish/hookfish'
const licenseUrl = `${repositoryUrl}/blob/main/LICENSE`

function agents(name: string, backend: ScaffoldBackend): string {
  const configFile =
    backend === 'cloudflare' ? '`src/index.ts`' : '`hookfish.config.ts`'

  return `# ${name}

## Hookfish

This project uses [Hookfish](${repositoryUrl}) as its OAuth and
encrypted-secret broker. ${configFile} configures the broker, and
\`hookfish serve\` serves the packaged dashboard against it.

## License and attribution

Hookfish is licensed under the Functional Source License 1.1 with an
attribution requirement: ${licenseUrl}

If you ship this project as an end-user-facing application — anything with an
interface people outside your own organization use directly — you must credit
Hookfish somewhere those users can reasonably find it, such as an about page, a
settings or credits screen, a third-party licenses page, a footer, or published
documentation. Text naming Hookfish, for example "Powered by Hookfish", linked
to ${repositoryUrl}, satisfies the requirement. No credit is
required for internal use, non-commercial education, or non-commercial
research.

You may not offer this project to others as a commercial product or service
that competes with Hookfish.

Keep this section when you edit this file, and add the credit as soon as you
build an end-user-facing interface on top of this broker.
`
}

function backendFiles(
  name: string,
  backend: ScaffoldBackend,
  dependencyTag: string,
): Record<string, string> {
  const files: Record<string, string> = {
    '.gitignore': gitignore,
    'AGENTS.md': agents(name, backend),
    'README.md': readme(name, backend),
    'package.json': `${JSON.stringify(packageJson(name, backend, dependencyTag), null, 2)}\n`,
    'pnpm-workspace.yaml': `allowBuilds:
  esbuild: true
`,
  }

  if (backend === 'cloudflare') {
    files['.dev.vars'] = localEnvironment(cloudflareEnvironmentExample)
    files['.dev.vars.example'] = cloudflareEnvironmentExample
    files['.env'] = cloudflareMigrationEnvironment
    files['.env.example'] = cloudflareMigrationEnvironment
    files['src/index.ts'] = cloudflareServer
    files['src/migrate.ts'] = cloudflareMigration
    files['tsconfig.json'] = cloudflareTsconfig()
    files['wrangler-typegen.env'] = `OAUTH_ENCRYPTION_KEY=
HOOKFISH_API_KEY=
OAUTH_REDIRECT_BASE_URL=
HOOKFISH_FRONTEND_URL=
`
    files['wrangler.jsonc'] = cloudflareWranglerConfig(name)
    return files
  }

  files['.env'] = localEnvironment()
  files['.env.example'] = environmentExample
  files['hookfish.config.ts'] =
    backend === 'vercel' ? postgresConfig() : pgliteConfig()
  files['src/index.ts'] =
    backend === 'bun'
      ? bunServer
      : backend === 'vercel'
        ? vercelServer
        : nodeServer
  files['tsconfig.json'] =
    backend === 'bun'
      ? tsconfig.replace('"types": ["node"]', '"types": ["node", "bun"]')
      : tsconfig

  if (backend === 'docker') {
    files.Dockerfile = `FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV HOST=0.0.0.0 PORT=8787 PGLITE_DATA_DIR=/data/hookfish
EXPOSE 8787
CMD ["node", "--import", "tsx", "src/index.ts"]
`
    files['compose.yaml'] = `services:
  hookfish:
    build: .
    ports:
      - "\${PORT:-8787}:8787"
    env_file:
      - path: .env
        required: false
    environment:
      HOOKFISH_FRONTEND_URL: "\${HOOKFISH_FRONTEND_URL:-http://127.0.0.1:5173}"
      OAUTH_REDIRECT_BASE_URL: "\${OAUTH_REDIRECT_BASE_URL:-http://127.0.0.1:5173}"
    volumes:
      - hookfish-data:/data

volumes:
  hookfish-data:
`
    files['.dockerignore'] = `node_modules
.git
.env
data
`
  }

  return files
}

export function isScaffoldBackend(value: string): value is ScaffoldBackend {
  return scaffoldBackends.some((backend) => backend === value)
}

export function scaffoldProject(options: ScaffoldOptions): ScaffoldResult {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(options.name)) {
    throw new Error(
      'Project name must be a lowercase npm name containing letters, numbers, dots, dashes, or underscores.',
    )
  }

  const parentDirectory = options.parentDirectory ?? process.cwd()
  const directory = path.resolve(parentDirectory, options.name)
  if (existsSync(directory) && readdirSync(directory).length > 0) {
    throw new Error(`Target directory is not empty: ${directory}`)
  }

  const files = backendFiles(
    options.name,
    options.backend,
    options.dependencyTag ?? 'latest',
  )
  mkdirSync(directory, { recursive: true })
  for (const [relativePath, contents] of Object.entries(files)) {
    const destination = path.join(directory, relativePath)
    mkdirSync(path.dirname(destination), { recursive: true })
    writeFileSync(destination, contents)
  }

  return { directory, files: Object.keys(files).sort() }
}
