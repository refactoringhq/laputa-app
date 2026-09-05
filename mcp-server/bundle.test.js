import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'

const MCP_SERVER_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPOSITORY_ROOT = path.dirname(MCP_SERVER_DIR)
const BUNDLE_DIR = path.join(REPOSITORY_ROOT, 'src-tauri', 'resources', 'mcp-server')

let artifactDir
let vaultDir

before(async () => {
  await rm(BUNDLE_DIR, { force: true, recursive: true })
  await runProcess(process.execPath, ['scripts/bundle-mcp-server.mjs'], {
    cwd: REPOSITORY_ROOT,
  })

  artifactDir = await mkdtemp(path.join(os.tmpdir(), 'tolaria-mcp-bundle-'))
  vaultDir = await mkdtemp(path.join(os.tmpdir(), 'tolaria-mcp-vault-'))
  await cp(BUNDLE_DIR, artifactDir, { recursive: true })
  await mkdir(path.join(vaultDir, 'notes'))
})

after(async () => {
  await Promise.all([
    artifactDir && rm(artifactDir, { force: true, recursive: true }),
    vaultDir && rm(vaultDir, { force: true, recursive: true }),
  ])
})

describe('packaged MCP entrypoints', () => {
  it('completes an initialize handshake outside the source tree', async () => {
    const response = await initializeMcpBundle()

    assert.equal(response.jsonrpc, '2.0')
    assert.equal(response.id, 1)
    assert.equal(response.result.serverInfo.name, 'tolaria-mcp-server')
  })

  it('starts the WebSocket bridge outside the source tree', async () => {
    const [toolPort, uiPort] = await availablePorts(2)
    const child = spawn(process.execPath, [path.join(artifactDir, 'ws-bridge.js')], {
      cwd: artifactDir,
      env: {
        ...process.env,
        VAULT_PATH: vaultDir,
        WS_PORT: String(toolPort),
        WS_UI_PORT: String(uiPort),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    })

    try {
      await waitForStderr(child, `[ws-bridge] Listening on ws://localhost:${toolPort}`)
    } finally {
      await terminateChild(child)
    }
  })
})

async function initializeMcpBundle() {
  const child = spawn(process.execPath, [path.join(artifactDir, 'index.js')], {
    cwd: artifactDir,
    env: {
      ...process.env,
      VAULT_PATH: vaultDir,
      WS_UI_PORT: '65534',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  try {
    const response = await waitForJsonRpcResponse(child, 1)
    return response
  } finally {
    child.stdin.end()
    await terminateChild(child)
  }
}

function waitForJsonRpcResponse(child, id) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for MCP initialize response\n${stderr}`))
    }, 3_000)
    const onStdout = (chunk) => {
      stdout += chunk
      const lines = stdout.split('\n')
      stdout = lines.pop() ?? ''
      for (const line of lines) {
        if (!line) continue
        let message
        try {
          message = JSON.parse(line)
        } catch (error) {
          cleanup()
          reject(new Error(`Invalid JSON-RPC response: ${error.message}\n${line}`))
          return
        }
        if (message.id === id) {
          cleanup()
          resolve(message)
          return
        }
      }
    }
    const onStderr = (chunk) => {
      stderr += chunk
    }
    const onExit = (code, signal) => {
      cleanup()
      reject(new Error(`MCP bundle exited with ${code ?? signal}\n${stderr}`))
    }
    const cleanup = () => {
      clearTimeout(timeout)
      child.stdout.off('data', onStdout)
      child.stderr.off('data', onStderr)
      child.off('exit', onExit)
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', onStdout)
    child.stderr.on('data', onStderr)
    child.once('exit', onExit)
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'tolaria-packaged-mcp-test', version: '0.0.0' },
      },
    })}\n`)
  })
}

async function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return

  child.kill('SIGTERM')
  if (await waitForExit(child, 1_000)) return
  child.kill('SIGKILL')
  await waitForExit(child, 1_000)
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.off('exit', onExit)
      resolve(false)
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timeout)
      resolve(true)
    }
    child.once('exit', onExit)
  })
}

async function availablePorts(count) {
  const servers = Array.from({ length: count }, () => createServer())
  await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, 'localhost', resolve)
  })))
  const ports = servers.map((server) => {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    return address.port
  })
  await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })))
  return ports
}

function runProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(
        `${command} exited with ${code ?? signal}\n${stdout.join('')}\n${stderr.join('')}`,
      ))
    })
  })
}

function waitForStderr(child, expected) {
  return new Promise((resolve, reject) => {
    let stderr = ''
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for ${expected}\n${stderr}`))
    }, 3_000)
    const onData = (chunk) => {
      stderr += chunk
      if (stderr.includes(expected)) {
        cleanup()
        resolve()
      }
    }
    const onExit = (code, signal) => {
      cleanup()
      reject(new Error(`WebSocket bundle exited with ${code ?? signal}\n${stderr}`))
    }
    const cleanup = () => {
      clearTimeout(timeout)
      child.stderr.off('data', onData)
      child.off('exit', onExit)
    }
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', onData)
    child.once('exit', onExit)
  })
}
