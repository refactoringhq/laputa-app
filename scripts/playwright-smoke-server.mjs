#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = process.argv[2] ?? process.env.PORT ?? '41741'
const viteCacheDir = process.env.TOLARIA_VITE_CACHE_DIR ?? join(tmpdir(), `tolaria-vite-smoke-${port}`)

const child = spawn(
  'pnpm',
  ['dev', '--host', '127.0.0.1', '--port', port, '--strictPort'],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TOLARIA_VITE_CACHE_DIR: viteCacheDir,
    },
    stdio: ['pipe', 'inherit', 'inherit'],
  },
)

function forwardSignal(signal) {
  if (child.killed) return
  child.kill(signal)
}

process.on('SIGINT', () => forwardSignal('SIGINT'))
process.on('SIGTERM', () => forwardSignal('SIGTERM'))

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 1)
})
