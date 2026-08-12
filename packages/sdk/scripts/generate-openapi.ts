import { writeFile } from 'node:fs/promises'
import { createHookfishOpenAPIDocument } from '@hookfish/api'

const document = await createHookfishOpenAPIDocument()
const output = new URL('../openapi.json', import.meta.url)

await writeFile(output, `${JSON.stringify(document, null, 2)}\n`)
