#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { constants } from 'node:os'
import { fileURLToPath } from 'node:url'

const tsxCli = fileURLToPath(import.meta.resolve('tsx/cli'))
const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url))
const child = spawn(
  process.execPath,
  [tsxCli, entry, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
  },
)
const forwardedSignals = ['SIGINT', 'SIGTERM']

for (const signal of forwardedSignals) {
  process.on(signal, () => child.kill(signal))
}

child.once('error', (error) => {
  console.error(error)
  process.exitCode = 1
})

child.once('exit', (code, signal) => {
  process.removeAllListeners('SIGINT')
  process.removeAllListeners('SIGTERM')
  if (signal) {
    process.exitCode = 128 + (constants.signals[signal] ?? 0)
    return
  }
  process.exitCode = code ?? 1
})
