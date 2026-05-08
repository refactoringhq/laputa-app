import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  mkdtemp, mkdir, open, rm,
} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  findMarkdownFiles, getNote, searchNotes, vaultContext,
} from './vault.js'
import {
  requireVaultPath, resolveVaultPath, loadVaultList, vaultsJsonPath,
} from './vault-path.js'
import { evaluateBridgeRequest } from './ws-bridge.js'

let tmpDir
const tempConfigDirs = []
const ACTIVE_VAULT_ERROR = 'Note path must stay inside the active vault'
const MCP_SERVER_DIR = path.dirname(fileURLToPath(import.meta.url))

before(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'laputa-mcp-test-'))

  await mkdir(path.join(tmpDir, 'project'), { recursive: true })
  await mkdir(path.join(tmpDir, 'note'), { recursive: true })

  await writeTextFile(path.join(tmpDir, 'project', 'test-project.md'), `---
title: Test Project
is_a: Project
status: Active
---

# Test Project

This is a test project for the MCP server.
`)

  await writeTextFile(path.join(tmpDir, 'note', 'daily-log.md'), `---
title: Daily Log
is_a: Note
---

# Daily Log

Today I worked on the MCP server implementation.
`)

  await writeTextFile(path.join(tmpDir, 'project', 'second-project.md'), `---
title: Second Project
type: Project
status: Draft
belongs_to:
  - "[[project/test-project]]"
---

# Second Project

Another project for testing list and context.
`)
})

after(async () => {
  await rm(tmpDir, { recursive: true, force: true })
  await Promise.all(tempConfigDirs.map(dir => rm(dir, { recursive: true, force: true })))
})

describe('findMarkdownFiles', () => {
  it('should find all .md files recursively', async () => {
    const files = await findMarkdownFiles(tmpDir)
    assert.equal(files.length, 3)
    assert.ok(files.some(f => f.endsWith('test-project.md')))
    assert.ok(files.some(f => f.endsWith('daily-log.md')))
    assert.ok(files.some(f => f.endsWith('second-project.md')))
  })
})

describe('getNote', () => {
  it('should read a note with parsed frontmatter', async () => {
    const note = await getNote(tmpDir, 'project/test-project.md')
    assert.equal(note.path, 'project/test-project.md')
    assert.equal(note.frontmatter.title, 'Test Project')
    assert.equal(note.frontmatter.is_a, 'Project')
    assert.ok(note.content.includes('test project for the MCP server'))
  })

  it('should throw for missing notes', async () => {
    await assert.rejects(
      () => getNote(tmpDir, 'nonexistent.md'),
      { code: 'ENOENT' }
    )
  })

  it('should reject absolute paths outside the vault', async () => {
    await assertRejectsOutsideVault('laputa-mcp-outside-', outsideNote => outsideNote)
  })

  it('should reject traversal paths outside the vault', async () => {
    await assertRejectsOutsideVault(
      'laputa-mcp-traversal-',
      outsideNote => path.relative(tmpDir, outsideNote),
    )
  })
})

describe('searchNotes', () => {
  it('should find notes matching title', async () => {
    const results = await searchNotes(tmpDir, 'Test Project')
    assert.ok(results.length >= 1)
    assert.equal(results[0].title, 'Test Project')
  })

  it('should find notes matching content', async () => {
    const results = await searchNotes(tmpDir, 'MCP server')
    assert.ok(results.length >= 1)
  })

  it('should return empty for no matches', async () => {
    const results = await searchNotes(tmpDir, 'xyzzy-nonexistent-12345')
    assert.equal(results.length, 0)
  })

  it('should respect limit', async () => {
    const results = await searchNotes(tmpDir, 'project', 1)
    assert.ok(results.length <= 1)
  })
})

describe('vaultContext', () => {
  it('should return types, recent notes, and vault path', async () => {
    const ctx = await vaultContext(tmpDir)
    assert.ok(Array.isArray(ctx.types))
    assert.ok(Array.isArray(ctx.recentNotes))
    assert.equal(ctx.vaultPath, tmpDir)
  })

  it('should include known entity types', async () => {
    const ctx = await vaultContext(tmpDir)
    assert.ok(ctx.types.includes('Project'))
    assert.ok(ctx.types.includes('Note'))
  })

  it('should cap recent notes at 20', async () => {
    const ctx = await vaultContext(tmpDir)
    assert.ok(ctx.recentNotes.length <= 20)
  })

  it('should include path and title in recent notes', async () => {
    const ctx = await vaultContext(tmpDir)
    for (const note of ctx.recentNotes) {
      assert.ok(note.path)
      assert.ok(note.title)
    }
  })

  it('should include folders', async () => {
    const ctx = await vaultContext(tmpDir)
    assert.ok(ctx.folders.includes('project/'))
    assert.ok(ctx.folders.includes('note/'))
  })

  it('should report correct note count', async () => {
    const ctx = await vaultContext(tmpDir)
    assert.equal(ctx.noteCount, 3)
  })
})

describe('evaluateBridgeRequest', () => {
  it('accepts loopback UI requests from trusted origins', () => {
    assert.deepEqual(
      evaluateBridgeRequest({
        bridgeType: 'ui',
        origin: 'http://localhost:5202',
        remoteAddress: '127.0.0.1',
      }),
      { ok: true, reason: null },
    )
  })

  it('rejects browser origins on the tool bridge', () => {
    assert.deepEqual(
      evaluateBridgeRequest({
        bridgeType: 'tool',
        origin: 'https://evil.example',
        remoteAddress: '127.0.0.1',
      }),
      { ok: false, reason: 'browser origins are not allowed on the tool bridge' },
    )
  })

  it('rejects non-loopback clients even without an origin', () => {
    assert.deepEqual(
      evaluateBridgeRequest({
        bridgeType: 'ui',
        origin: undefined,
        remoteAddress: '192.168.1.10',
      }),
      { ok: false, reason: 'non-local client' },
    )
  })
})

describe('requireVaultPath', () => {
  it('returns the explicit configured vault path', () => {
    assert.equal(
      requireVaultPath({ VAULT_PATH: '/tmp/Selected Vault' }),
      '/tmp/Selected Vault',
    )
  })

  it('rejects missing vault paths instead of falling back to ~/Laputa', () => {
    assert.throws(
      () => requireVaultPath({}),
      /VAULT_PATH is required/,
    )
  })
})

describe('resolveVaultPath', () => {
  it('returns session override when provided', () => {
    assert.equal(
      resolveVaultPath('/tmp/session-vault', { env: {} }),
      '/tmp/session-vault',
    )
  })

  it('returns VAULT_PATH env when set and no override', () => {
    assert.equal(
      resolveVaultPath(undefined, { env: { VAULT_PATH: '/tmp/env-vault' } }),
      '/tmp/env-vault',
    )
  })

  it('returns active_vault from vaults.json when env is unset', async () => {
    const configDir = await createConfigDirFixture({
      files: {
        'com.tolaria.app': {
          active_vault: '/tmp/active-vault',
          vaults: [
            { label: 'Active', path: '/tmp/active-vault' },
            { label: 'Other', path: '/tmp/other-vault' },
          ],
        },
      }
    })

    assert.equal(
      resolveVaultPath(undefined, {
        env: {},
        loadVaultListFn: () => loadVaultList({ configDir }),
      }),
      '/tmp/active-vault',
    )
  })

  it('returns single vault path when vaults.json has exactly one vault', async () => {
    const configDir = await createConfigDirFixture({
      files: {
        'com.tolaria.app': {
          vaults: [{ label: 'Only', path: '/tmp/only-vault' }],
        },
      }
    })

    assert.equal(
      resolveVaultPath(undefined, {
        env: {},
        loadVaultListFn: () => loadVaultList({ configDir }),
      }),
      '/tmp/only-vault',
    )
  })

  it('throws Multiple vaults error when vaults.json has >1 vault and no active_vault', async () => {
    const configDir = await createConfigDirFixture({
      files: {
        'com.tolaria.app': {
          vaults: [
            { label: 'First', path: '/tmp/first-vault' },
            { label: 'Second', path: '/tmp/second-vault' },
          ],
        },
      }
    })

    assert.throws(
      () => resolveVaultPath(undefined, {
        env: {},
        loadVaultListFn: () => loadVaultList({ configDir }),
      }),
      /Multiple vaults configured but none is active/,
    )
  })

  it('throws No vault configured when no env and no vaults.json', async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), 'tolaria-config-test-'))
    tempConfigDirs.push(configDir)

    assert.throws(
      () => resolveVaultPath(undefined, {
        env: {},
        loadVaultListFn: () => loadVaultList({ configDir }),
      }),
      /No vault configured\. Open a vault in Tolaria first\./,
    )
  })
})

describe('loadVaultList', () => {
  it('returns null when vaults.json does not exist', async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), 'tolaria-config-test-'))
    tempConfigDirs.push(configDir)

    assert.equal(loadVaultList({ configDir }), null)
  })

  it('parses valid vaults.json with multiple vaults', async () => {
    const configDir = await createConfigDirFixture({
      files: {
        'com.tolaria.app': {
          active_vault: '/tmp/active-vault',
          vaults: [
            { label: 'A', path: '/tmp/a', alias: 'alpha' },
            { label: 'B', path: '/tmp/b' },
          ],
        },
      }
    })

    assert.deepEqual(loadVaultList({ configDir }), {
      activeVault: '/tmp/active-vault',
      vaults: [
        { label: 'A', path: '/tmp/a', alias: 'alpha' },
        { label: 'B', path: '/tmp/b', alias: null },
      ],
    })
  })

  it('returns null on malformed JSON', async () => {
    const configDir = await createConfigDirFixture({
      files: {
        'com.tolaria.app': '{not-json',
      }
    })

    assert.equal(loadVaultList({ configDir }), null)
  })
})

describe('vaultsJsonPath', () => {
  it('prefers com.tolaria.app over com.laputa.app', async () => {
    const configDir = await createConfigDirFixture({
      files: {
        'com.tolaria.app': { vaults: [{ label: 'Preferred', path: '/tmp/preferred' }] },
        'com.laputa.app': { vaults: [{ label: 'Legacy', path: '/tmp/legacy' }] },
      }
    })

    assert.equal(
      vaultsJsonPath({ configDir }),
      path.join(configDir, 'com.tolaria.app', 'vaults.json'),
    )
  })

  it('falls back to com.laputa.app when preferred missing', async () => {
    const configDir = await createConfigDirFixture({
      files: {
        'com.laputa.app': { vaults: [{ label: 'Legacy', path: '/tmp/legacy' }] },
      }
    })

    assert.equal(
      vaultsJsonPath({ configDir }),
      path.join(configDir, 'com.laputa.app', 'vaults.json'),
    )
  })
})

describe('stdio process lifecycle', () => {
  it('exits when the MCP client closes stdin', async () => {
    const child = spawn(process.execPath, ['index.js'], {
      cwd: MCP_SERVER_DIR,
      env: { ...process.env, VAULT_PATH: tmpDir, WS_UI_PORT: '65534' },
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      stderr += chunk
    })

    await sleep(200)
    child.stdin.end()

    const exit = await waitForExit(child, 1_500)
    if (!exit) {
      child.kill()
      await waitForExit(child, 1_000)
      assert.fail(`MCP server stayed alive after stdin closed.\n${stderr}`)
    }

    assert.equal(exit.signal, null)
    assert.equal(exit.code, 0, stderr)
  })

  it('lists list_vaults and switch_vault tools without VAULT_PATH', async () => {
    const child = spawn(process.execPath, ['index.js'], {
      cwd: MCP_SERVER_DIR,
      env: { ...process.env, WS_UI_PORT: '65534' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      stderr += chunk
    })

    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.1' },
      },
    })}\n`)

    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    })}\n`)

    const toolsListResponse = await waitForJsonRpcResponse(child, 2, 2_000)
    child.stdin.end()
    await waitForExit(child, 1_500)

    const toolNames = (toolsListResponse.result?.tools || []).map(tool => tool.name)
    assert.ok(toolNames.includes('list_vaults'), `Expected list_vaults in tools/list. stderr:\n${stderr}`)
    assert.ok(toolNames.includes('switch_vault'), `Expected switch_vault in tools/list. stderr:\n${stderr}`)
  })
})

async function assertRejectsOutsideVault(prefix, resolveNotePath) {
  const outsideDir = await mkdtemp(path.join(os.tmpdir(), prefix))
  const outsideNote = path.join(outsideDir, 'outside.md')

  try {
    await writeTextFile(outsideNote, '# Outside\n')
    await assert.rejects(
      () => getNote(tmpDir, resolveNotePath(outsideNote)),
      { message: ACTIVE_VAULT_ERROR },
    )
  } finally {
    await rm(outsideDir, { recursive: true, force: true })
  }
}

async function writeTextFile(filePath, content) {
  const handle = await open(filePath, 'w')
  try {
    await handle.writeFile(content, 'utf-8')
  } finally {
    await handle.close()
  }
}

async function createConfigDirFixture({ files = {} } = {}) {
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'tolaria-config-test-'))
  tempConfigDirs.push(configDir)

  await Promise.all(Object.entries(files).map(async ([appDir, content]) => {
    const appConfigDir = path.join(configDir, appDir)
    await mkdir(appConfigDir, { recursive: true })
    const rawContent = typeof content === 'string' ? content : JSON.stringify(content)
    await writeTextFile(path.join(appConfigDir, 'vaults.json'), rawContent)
  }))

  return configDir
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve(null)
    }, timeoutMs)

    child.once('exit', onExit)

    function onExit(code, signal) {
      cleanup()
      resolve({ code, signal })
    }

    function cleanup() {
      clearTimeout(timer)
      child.off('exit', onExit)
    }
  })
}

function waitForJsonRpcResponse(child, id, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = ''

    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for JSON-RPC response id=${id}`))
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', onData)
    child.once('error', onError)
    child.once('exit', onExit)

    function onData(chunk) {
      buffer += chunk
      let lineEnd = buffer.indexOf('\n')
      while (lineEnd !== -1) {
        const line = buffer.slice(0, lineEnd).trim()
        buffer = buffer.slice(lineEnd + 1)

        if (!line) {
          lineEnd = buffer.indexOf('\n')
          continue
        }

        let payload
        try {
          payload = JSON.parse(line)
        } catch {
          lineEnd = buffer.indexOf('\n')
          continue
        }

        if (payload.id === id) {
          cleanup()
          resolve(payload)
          return
        }

        lineEnd = buffer.indexOf('\n')
      }
    }

    function onError(error) {
      cleanup()
      reject(error)
    }

    function onExit(code, signal) {
      cleanup()
      reject(new Error(`Process exited before response id=${id} (code=${code}, signal=${signal})`))
    }

    function cleanup() {
      clearTimeout(timer)
      child.stdout.off('data', onData)
      child.off('error', onError)
      child.off('exit', onExit)
    }
  })
}
