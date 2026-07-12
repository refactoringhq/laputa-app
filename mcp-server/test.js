import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  access, mkdtemp, mkdir, open, readFile, rm, writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  appendToNote, createNote, findMarkdownFiles, getNote, searchNotes, updateNote, vaultContext,
} from './vault.js'
import {
  appConfigBaseDirs,
  appConfigFilePath,
  requireVaultPath,
  requireVaultPaths,
} from './vault-path.js'
import { vaultContextWithInstructions } from './agent-instructions.js'
import { evaluateBridgeRequest } from './ws-bridge.js'

let tmpDir
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

  await writeTextFile(path.join(tmpDir, 'note', 'hashtag-tags.md'), `---
title: Hashtag Tags
type: Note
tags: [#abc, def, ghi]
---

# Hashtag Tags

This note has AI-generated hashtag-style YAML tags.
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
})

describe('findMarkdownFiles', () => {
  it('should find all .md files recursively', async () => {
    const files = await findMarkdownFiles(tmpDir)
    assert.equal(files.length, 4)
    assert.ok(files.some(f => f.endsWith('test-project.md')))
    assert.ok(files.some(f => f.endsWith('daily-log.md')))
    assert.ok(files.some(f => f.endsWith('second-project.md')))
    assert.ok(files.some(f => f.endsWith('hashtag-tags.md')))
  })
})

describe('getNote', () => {
  it('should read a note with parsed frontmatter', async () => {
    const note = await getNote(tmpDir, 'project/test-project.md')
    assert.equal(note.path, 'project/test-project.md')
    assert.equal(note.frontmatter.title, 'Test Project')
    assert.equal(note.frontmatter.is_a, 'Project')
    assert.ok(note.content.includes('test project for the MCP server'))
    assert.ok(note.mtimeMs > 0)
  })

  it('should tolerate hashtag-style tags in malformed YAML frontmatter', async () => {
    const note = await getNote(tmpDir, 'note/hashtag-tags.md')
    assert.equal(note.path, 'note/hashtag-tags.md')
    assert.equal(note.frontmatter.title, 'Hashtag Tags')
    assert.equal(note.frontmatter.type, 'Note')
    assert.deepEqual(note.frontmatter.tags, ['#abc', 'def', 'ghi'])
    assert.ok(note.content.includes('has AI-generated hashtag-style YAML tags'))
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

describe('createNote', () => {
  it('creates a new markdown note inside the vault', async () => {
    const vaultDir = await mkdtemp(path.join(os.tmpdir(), 'laputa-mcp-create-'))
    const content = `---
type: Note
---

# MCP Created
`

    try {
      const note = await createNote(vaultDir, 'note/mcp-created.md', content)
      assert.equal(note.path, 'note/mcp-created.md')
      assert.equal(await readFile(path.join(vaultDir, note.path), 'utf-8'), content)
    } finally {
      await rm(vaultDir, { recursive: true, force: true })
    }
  })

  it('does not overwrite an existing note', async () => {
    const vaultDir = await mkdtemp(path.join(os.tmpdir(), 'laputa-mcp-create-existing-'))
    const notePath = path.join(vaultDir, 'existing.md')
    await writeFile(notePath, '# Existing\n', 'utf-8')

    try {
      await assert.rejects(
        () => createNote(vaultDir, 'existing.md', '# Replacement\n'),
        { code: 'EEXIST' },
      )
      assert.equal(await readFile(notePath, 'utf-8'), '# Existing\n')
    } finally {
      await rm(vaultDir, { recursive: true, force: true })
    }
  })

  it('rejects absolute paths outside the vault', async () => {
    await assertWriteRejectsOutsideVault('laputa-mcp-create-', (vaultDir, outsideNote) => (
      createNote(vaultDir, outsideNote, '# Outside\n')
    ))
  })

  it('rejects outside paths before creating missing parent folders', async () => {
    const vaultDir = await mkdtemp(path.join(os.tmpdir(), 'laputa-mcp-create-vault-'))
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), 'laputa-mcp-create-outside-'))
    const outsideParent = path.join(outsideDir, 'missing-parent')

    try {
      await assert.rejects(
        () => createNote(vaultDir, path.join(outsideParent, 'outside.md'), '# Outside\n'),
        { message: ACTIVE_VAULT_ERROR },
      )
      await assert.rejects(() => access(outsideParent), { code: 'ENOENT' })
    } finally {
      await rm(vaultDir, { recursive: true, force: true })
      await rm(outsideDir, { recursive: true, force: true })
    }
  })
})

describe('updateNote', () => {
  it('replaces the content of an existing note', async () => {
    const vaultDir = await mkdtemp(path.join(os.tmpdir(), 'laputa-mcp-update-'))
    const notePath = path.join(vaultDir, 'note', 'existing.md')
    await mkdir(path.dirname(notePath), { recursive: true })
    await writeFile(notePath, '---\ntype: Note\n---\n\n# Old\n', 'utf-8')
    const newContent = '---\ntype: Project\n---\n\n# Updated\n'

    try {
      const note = await updateNote(vaultDir, 'note/existing.md', newContent)
      assert.equal(note.path, 'note/existing.md')
      assert.equal(await readFile(notePath, 'utf-8'), newContent)
      assert.ok(note.mtimeMs > 0)
    } finally {
      await rm(vaultDir, { recursive: true, force: true })
    }
  })

  it('throws ENOENT when updating a missing note', async () => {
    await assertMissingNoteRejects('laputa-mcp-update-missing-', vaultDir => (
      updateNote(vaultDir, 'note/missing.md', '# New\n')
    ))
  })

  it('fails with a clear conflict message when expectedMtime does not match', async () => {
    const vaultDir = await mkdtemp(path.join(os.tmpdir(), 'laputa-mcp-update-conflict-'))
    const notePath = path.join(vaultDir, 'stale.md')
    await writeFile(notePath, '# Stale\n', 'utf-8')

    try {
      await assert.rejects(
        () => updateNote(vaultDir, 'stale.md', '# New\n', { expectedMtime: 1 }),
        /expectedMtime/,
      )
      // Original content survives the failed update.
      assert.equal(await readFile(notePath, 'utf-8'), '# Stale\n')
    } finally {
      await rm(vaultDir, { recursive: true, force: true })
    }
  })

  it('succeeds when expectedMtime matches the on-disk mtimeMs', async () => {
    const vaultDir = await mkdtemp(path.join(os.tmpdir(), 'laputa-mcp-update-match-'))
    const notePath = path.join(vaultDir, 'match.md')
    await writeFile(notePath, '# Original\n', 'utf-8')
    const { mtimeMs } = await getNote(vaultDir, 'match.md')
    const newContent = '# Updated\n'

    try {
      const note = await updateNote(vaultDir, 'match.md', newContent, {
        expectedMtime: mtimeMs,
      })
      assert.equal(await readFile(notePath, 'utf-8'), newContent)
      assert.ok(note.mtimeMs >= mtimeMs)
    } finally {
      await rm(vaultDir, { recursive: true, force: true })
    }
  })

  it('rejects absolute paths outside the vault', async () => {
    await assertWriteRejectsOutsideVault('laputa-mcp-update-', (vaultDir, outsideNote) => (
      updateNote(vaultDir, outsideNote, '# Outside\n')
    ))
  })
})

describe('appendToNote', () => {
  it('appends content to an existing note body', async () => {
    const vaultDir = await mkdtemp(path.join(os.tmpdir(), 'laputa-mcp-append-'))
    const notePath = path.join(vaultDir, 'log.md')
    await writeFile(notePath, '---\ntype: Note\n---\n\n# Log\n\nFirst entry.\n', 'utf-8')

    try {
      const note = await appendToNote(vaultDir, 'log.md', 'Second entry.\n')
      assert.equal(
        await readFile(notePath, 'utf-8'),
        '---\ntype: Note\n---\n\n# Log\n\nFirst entry.\nSecond entry.\n',
      )
      assert.ok(note.mtimeMs > 0)
    } finally {
      await rm(vaultDir, { recursive: true, force: true })
    }
  })

  it('throws ENOENT when appending to a missing note', async () => {
    await assertMissingNoteRejects('laputa-mcp-append-missing-', vaultDir => (
      appendToNote(vaultDir, 'missing.md', 'More')
    ))
  })

  it('rejects absolute paths outside the vault', async () => {
    await assertWriteRejectsOutsideVault('laputa-mcp-append-', (vaultDir, outsideNote) => (
      appendToNote(vaultDir, outsideNote, 'More')
    ))
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

  it('should include notes with hashtag-style tags in malformed YAML frontmatter', async () => {
    const ctx = await vaultContext(tmpDir)
    const note = ctx.recentNotes.find(entry => entry.path === 'note/hashtag-tags.md')
    assert.ok(note)
    assert.equal(note.title, 'Hashtag Tags')
    assert.equal(note.type, 'Note')
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
    assert.equal(ctx.noteCount, 4)
  })

  it('includes root AGENTS.md instructions when present', async () => {
    const agentsPath = path.join(tmpDir, 'AGENTS.md')
    await writeFile(agentsPath, '# Vault Rules\n\nUse this vault carefully.\n', 'utf-8')

    try {
      const ctx = await vaultContextWithInstructions(tmpDir)
      assert.deepEqual(ctx.agentInstructions, {
        path: agentsPath,
        content: '# Vault Rules\n\nUse this vault carefully.\n',
      })
    } finally {
      await rm(agentsPath, { force: true })
    }
  })

  it('reports null agent instructions when AGENTS.md is absent', async () => {
    const ctx = await vaultContextWithInstructions(tmpDir)
    assert.equal(ctx.agentInstructions, null)
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

  it('rejects missing vault paths instead of falling back to ~/Laputa', async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), 'tolaria-mcp-empty-config-'))
    assert.throws(
      () => requireVaultPaths({}, { configDir }),
      /VAULT_PATH is required/,
    )
    await rm(configDir, { recursive: true, force: true })
  })

  it('returns all configured active vault paths with the primary vault first', () => {
    assert.deepEqual(
      requireVaultPaths({
        VAULT_PATH: '/tmp/Default Vault',
        VAULT_PATHS: JSON.stringify(['/tmp/Default Vault', '/tmp/Second Vault']),
      }),
      ['/tmp/Default Vault', '/tmp/Second Vault'],
    )
  })

  it('loads active mounted vault paths from Tolaria config when env is vault-neutral', async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), 'tolaria-mcp-config-'))
    const primaryVault = path.join(configDir, 'Primary Vault')
    const secondaryVault = path.join(configDir, 'Secondary Vault')
    const hiddenVault = path.join(configDir, 'Hidden Vault')
    const configPath = path.join(configDir, 'com.tolaria.app', 'vaults.json')

    await mkdir(path.dirname(configPath), { recursive: true })
    await writeFile(configPath, JSON.stringify({
      active_vault: primaryVault,
      vaults: [
        { label: 'Secondary', path: secondaryVault, mounted: true },
        { label: 'Hidden', path: hiddenVault, mounted: false },
        { label: 'Primary', path: primaryVault, mounted: true },
      ],
    }), 'utf-8')

    try {
      assert.deepEqual(
        requireVaultPaths({}, { configDir }),
        [primaryVault, secondaryVault],
      )
    } finally {
      await rm(configDir, { recursive: true, force: true })
    }
  })

  it('uses one app config resolver for settings and vault registry files', async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), 'tolaria-mcp-shared-config-'))
    const files = ['settings.json', 'vaults.json']

    for (const fileName of files) {
      const legacyPath = path.join(configDir, 'com.laputa.app', fileName)
      await mkdir(path.dirname(legacyPath), { recursive: true })
      await writeFile(legacyPath, '{}', 'utf-8')
    }

    try {
      for (const fileName of files) {
        assert.equal(
          appConfigFilePath(fileName, { configDir }),
          path.join(configDir, 'com.laputa.app', fileName),
        )
      }
    } finally {
      await rm(configDir, { recursive: true, force: true })
    }
  })

  it('loads macOS vault registry from the XDG-backed Tolaria config before Application Support', async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), 'tolaria-mcp-macos-home-'))
    const primaryVault = path.join(homeDir, 'Primary Vault')
    const legacyPlatformVault = path.join(homeDir, 'Legacy Platform Vault')
    const xdgConfigPath = path.join(homeDir, '.config', 'com.tolaria.app', 'vaults.json')
    const platformConfigPath = path.join(
      homeDir,
      'Library',
      'Application Support',
      'com.tolaria.app',
      'vaults.json',
    )

    await mkdir(path.dirname(xdgConfigPath), { recursive: true })
    await mkdir(path.dirname(platformConfigPath), { recursive: true })
    await writeFile(xdgConfigPath, JSON.stringify({ active_vault: primaryVault, vaults: [] }), 'utf-8')
    await writeFile(
      platformConfigPath,
      JSON.stringify({ active_vault: legacyPlatformVault, vaults: [] }),
      'utf-8',
    )

    try {
      assert.deepEqual(
        requireVaultPaths({}, {
          configDirs: appConfigBaseDirs({ env: {}, homeDir, platformName: 'darwin' }),
        }),
        [primaryVault],
      )
    } finally {
      await rm(homeDir, { recursive: true, force: true })
    }
  })
})

describe('stdio process lifecycle', () => {
  it('advertises local vault tools as approval-safe for MCP clients', async () => {
    const { client, stderr } = await connectMcpClient()

    try {
      const toolsByName = await listMcpTools(client)
      assertToolsUseReadOnlyAnnotations(toolsByName, [
        'search_notes',
        'get_vault_context',
        'list_vaults',
        'get_note',
        'open_note',
        'highlight_editor',
        'refresh_vault',
      ])
      assertToolsUseWritableAnnotations(toolsByName, ['create_note', 'update_note', 'append_to_note'])
    } finally {
      await closeMcpClient(client, stderr)
    }
  })

  it('creates a note through the MCP create_note tool', async () => {
    const { client, stderr } = await connectMcpClient()
    const relativePath = 'note/mcp-tool-created.md'
    const absolutePath = path.join(tmpDir, relativePath)
    const content = `---
type: Note
---

# MCP Tool Created
`

    try {
      await rm(absolutePath, { force: true })
      const result = await client.callTool({
        name: 'create_note',
        arguments: { path: relativePath, content },
      })

      assert.equal(await readFile(absolutePath, 'utf-8'), content)
      assert.match(JSON.stringify(result.content), /mcp-tool-created\.md/)
    } finally {
      await rm(absolutePath, { force: true })
      await closeMcpClient(client, stderr)
    }
  })

  it('exposes update_note and append_to_note as writable, non-destructive tools', async () => {
    const { client, stderr } = await connectMcpClient()

    try {
      const toolsByName = await listMcpTools(client)
      assertWritableContentToolSchema(toolsByName, 'update_note')
      assertWritableContentToolSchema(toolsByName, 'append_to_note')
    } finally {
      await closeMcpClient(client, stderr)
    }
  })

  it('replaces a note through the MCP update_note tool', async () => {
    const { client, stderr } = await connectMcpClient()
    const relativePath = 'note/mcp-updated.md'
    const absolutePath = path.join(tmpDir, relativePath)
    const original = '# Original\n'
    const updated = '---\ntype: Note\n---\n\n# MCP Updated\n'

    try {
      await mkdir(path.dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, original, 'utf-8')

      const result = await client.callTool({
        name: 'update_note',
        arguments: {
          path: relativePath,
          content: updated,
          expectedMtime: toolTextJson(await client.callTool({
            name: 'get_note',
            arguments: { path: relativePath },
          })).mtimeMs,
        },
      })
      const payload = toolTextJson(result)

      assert.equal(await readFile(absolutePath, 'utf-8'), updated)
      assert.equal(payload.path, relativePath)
      assert.ok(payload.mtimeMs > 0)
    } finally {
      await rm(absolutePath, { force: true })
      await closeMcpClient(client, stderr)
    }
  })

  it('appends content through the MCP append_to_note tool', async () => {
    const { client, stderr } = await connectMcpClient()
    const relativePath = 'note/mcp-appended.md'
    const absolutePath = path.join(tmpDir, relativePath)
    const original = '# Original\n'

    try {
      await mkdir(path.dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, original, 'utf-8')

      await client.callTool({
        name: 'append_to_note',
        arguments: { path: relativePath, content: 'Appended line.\n' },
      })

      assert.equal(await readFile(absolutePath, 'utf-8'), `${original}Appended line.\n`)
    } finally {
      await rm(absolutePath, { force: true })
      await closeMcpClient(client, stderr)
    }
  })

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
})

async function connectMcpClient() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['index.js'],
    cwd: MCP_SERVER_DIR,
    env: { ...process.env, VAULT_PATH: tmpDir, WS_UI_PORT: '65534' },
    stderr: 'pipe',
  })
  const stderr = collectTransportStderr(transport)
  const client = new Client(
    { name: 'tolaria-mcp-test-client', version: '0.0.0' },
    { capabilities: {} },
  )

  await client.connect(transport)
  return { client, stderr }
}

function collectTransportStderr(transport) {
  const chunks = []
  transport.stderr?.setEncoding('utf8')
  transport.stderr?.on('data', chunk => {
    chunks.push(chunk)
  })
  return () => chunks.join('')
}

function toolTextJson(result) {
  return JSON.parse(result.content[0].text)
}

async function listMcpTools(client) {
  const { tools } = await client.listTools()
  return new Map(tools.map(tool => [tool.name, tool]))
}

function assertToolsUseReadOnlyAnnotations(toolsByName, names) {
  for (const name of names) {
    assertToolAnnotations(toolsByName, name, true)
  }
}

function assertToolsUseWritableAnnotations(toolsByName, names) {
  for (const name of names) {
    assertToolAnnotations(toolsByName, name, false)
  }
}

function assertToolAnnotations(toolsByName, name, readOnlyHint) {
  const tool = toolsByName.get(name)
  assert.ok(tool, `Missing MCP tool: ${name}`)
  assert.equal(tool.annotations?.readOnlyHint, readOnlyHint)
  assert.equal(tool.annotations?.destructiveHint, false)
  assert.equal(tool.annotations?.openWorldHint, false)
}

function assertWritableContentToolSchema(toolsByName, name) {
  assertToolAnnotations(toolsByName, name, false)
  const { inputSchema } = toolsByName.get(name)
  assert.ok(inputSchema?.properties?.path, `${name} must accept a path`)
  assert.ok(inputSchema?.properties?.content, `${name} must accept content`)
  assert.deepEqual(inputSchema?.required ?? [], ['path', 'content'])
}

async function closeMcpClient(client, stderr) {
  try {
    await client.close()
  } catch (error) {
    assert.fail(`Failed to close MCP test client: ${error.message}\n${stderr()}`)
  }
}

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

async function assertMissingNoteRejects(prefix, writeMissingNote) {
  const vaultDir = await mkdtemp(path.join(os.tmpdir(), prefix))
  try {
    await assert.rejects(() => writeMissingNote(vaultDir), { code: 'ENOENT' })
  } finally {
    await rm(vaultDir, { recursive: true, force: true })
  }
}

async function assertWriteRejectsOutsideVault(prefix, writeOutsideNote) {
  const vaultDir = await mkdtemp(path.join(os.tmpdir(), `${prefix}vault-`))
  const outsideDir = await mkdtemp(path.join(os.tmpdir(), `${prefix}outside-`))
  const outsideNote = path.join(outsideDir, 'outside.md')

  try {
    await writeFile(outsideNote, '# Outside\n', 'utf-8')
    await assert.rejects(
      () => writeOutsideNote(vaultDir, outsideNote),
      { message: ACTIVE_VAULT_ERROR },
    )
  } finally {
    await rm(vaultDir, { recursive: true, force: true })
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
