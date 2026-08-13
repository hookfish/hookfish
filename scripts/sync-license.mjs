// Copies the root LICENSE into every publishable package so the npm tarballs
// carry the full text that each package.json points at with
// "license": "SEE LICENSE IN LICENSE". npm always includes a LICENSE file
// sitting at the package root, so the copies do not need a "files" entry.
// The copies are gitignored; the root LICENSE stays the only tracked source.
import { copyFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const license = path.join(root, 'LICENSE')
if (!existsSync(license)) {
  throw new Error(`Missing ${license}`)
}

function packageDirectories(directory) {
  const entries = readdirSync(directory, { withFileTypes: true })
  const found = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue
    const child = path.join(directory, entry.name)
    // packages/providers is itself a package and also holds the provider
    // packages, so keep descending after a match.
    if (existsSync(path.join(child, 'package.json'))) {
      found.push(child)
    }
    found.push(...packageDirectories(child))
  }
  return found
}

let copied = 0
for (const directory of packageDirectories(path.join(root, 'packages'))) {
  const manifest = JSON.parse(
    readFileSync(path.join(directory, 'package.json'), 'utf8'),
  )
  if (manifest.private) continue
  copyFileSync(license, path.join(directory, 'LICENSE'))
  copied += 1
}

console.log(`Copied LICENSE into ${copied} publishable packages.`)
