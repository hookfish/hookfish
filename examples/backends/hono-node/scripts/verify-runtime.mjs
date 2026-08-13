/**
 * Loads the published packages the way a plain Node app does: no loader, no
 * transpiler. Node refuses to strip types inside node_modules, so this fails
 * outright if a package ever goes back to shipping TypeScript sources.
 */
const modules = {
  '@hookfish/api': 'HookfishServer',
  '@hookfish/database': 'pglite',
  '@hookfish/providers': 'GitHubProvider',
  '@hookfish/sdk': 'Hookfish',
}

for (const [specifier, expected] of Object.entries(modules)) {
  const loaded = await import(
    specifier === '@hookfish/database' ? '@hookfish/database/pglite' : specifier
  )
  if (!(expected in loaded)) {
    throw new Error(`${specifier} loaded without exporting ${expected}`)
  }
  console.log(`ok ${specifier}`)
}
