import { cp } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const source = path.resolve(frontendRoot, '../../packages/api/drizzle')
const destination = path.join(frontendRoot, '.output/server/drizzle')

await cp(source, destination, { recursive: true, force: true })
