import { cpSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const destinationArgument = process.argv[2]
if (!destinationArgument) {
  throw new Error('Provide the migration destination directory.')
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const source = path.resolve(scriptDirectory, '../../../packages/api/drizzle')
const destination = path.resolve(process.cwd(), destinationArgument)

mkdirSync(path.dirname(destination), { recursive: true })
cpSync(source, destination, { recursive: true })
