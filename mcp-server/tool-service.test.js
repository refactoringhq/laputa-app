import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createMcpToolService } from './tool-service.js'

let tmpDir
let firstVault
let secondVault

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'tolaria-mcp-service-'))
  firstVault = path.join(tmpDir, 'First Vault')
  secondVault = path.join(tmpDir, 'Second Vault')

  await seedVault(firstVault, {
    'note/shared.md': noteFixture('Shared Note', 'Shared content from the first vault.'),
    'note/alpha.md': noteFixture('Alpha Project', 'Project planning in the first vault.'),
  })
  await seedVault(secondVault, {
    'AGENTS.md': '# Second Vault Rules\n',
    'note/shared.md': noteFixture('Shared Note', 'Shared content from the second vault.'),
    'note/beta.md': noteFixture('Beta Project', 'Project planning in the second vault.'),
  })
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('createMcpToolService', () => {
  it('requires vaultPath when reading an ambiguous note path', async () => {
    const service = makeService()

    await assert.rejects(
      () => service.readNote({ path: 'note/shared.md' }),
      /Note path is ambiguous across active vaults/,
    )

    const note = await service.readNote({
      path: 'note/shared.md',
      vaultPath: secondVault,
    })

    assert.equal(note.vaultPath, secondVault)
    assert.equal(note.vaultLabel, 'Second Vault')
    assert.match(note.content, /second vault/)
  })

  it('creates notes with fallback markdown and emits refresh and tab actions', async () => {
    const emittedActions = []
    const service = makeService({ emittedActions })
    const absolutePath = path.join(secondVault, 'note/created.md')

    const note = await service.createNote({
      path: absolutePath,
      title: 'Created From MCP',
      type: 'Project',
    })

    assert.equal(note.path, 'note/created.md')
    assert.equal(note.vaultPath, secondVault)
    assert.equal(path.basename(note.absolutePath), 'created.md')
    assert.equal(
      await readFile(note.absolutePath, 'utf-8'),
      '---\ntype: "Project"\n---\n\n# Created From MCP\n',
    )
    assert.deepEqual(emittedActions, [
      { action: 'vault_changed', payload: { path: absolutePath } },
      { action: 'open_tab', payload: { path: absolutePath } },
    ])
  })

  it('updates an existing note and emits a vault_changed action', async () => {
    const emittedActions = []
    const service = makeService({ emittedActions })
    const absolutePath = path.join(firstVault, 'note/alpha.md')
    const newContent = '---\ntitle: "Alpha"\ntype: Note\n---\n\n# Alpha\n\nRewritten.\n'

    const note = await service.updateNote({
      path: 'note/alpha.md',
      content: newContent,
      vaultPath: firstVault,
    })

    assert.equal(note.path, 'note/alpha.md')
    assert.equal(note.vaultPath, firstVault)
    assert.equal(await readFile(absolutePath, 'utf-8'), newContent)
    assert.deepEqual(emittedActions, [
      { action: 'vault_changed', payload: { path: absolutePath } },
    ])
  })

  it('fails updateNote with ENOENT-style error for missing notes', async () => {
    const service = makeService()

    await assert.rejects(
      () => service.updateNote({ path: 'note/ghost.md', content: '# Ghost\n', vaultPath: firstVault }),
      (error) => error.code === 'ENOENT' || /not found/i.test(error.message),
    )
  })

  it('rejects updateNote when expectedMtime does not match the on-disk note', async () => {
    const service = makeService()
    await writeFile(
      path.join(firstVault, 'note/alpha.md'),
      '---\ntitle: "Alpha"\ntype: Note\n---\n\n# Alpha\nOriginal.\n',
      'utf-8',
    )

    await assert.rejects(
      () => service.updateNote({
        path: 'note/alpha.md',
        content: '# Replaced\n',
        vaultPath: firstVault,
        expectedMtime: 1,
      }),
      /expectedMtime/,
    )

    // The conflict must leave the original note untouched.
    const after = await readFile(path.join(firstVault, 'note/alpha.md'), 'utf-8')
    assert.match(after, /Original\./)
  })

  it('appends content to an existing note and emits a vault_changed action', async () => {
    const emittedActions = []
    const service = makeService({ emittedActions })
    const absolutePath = path.join(secondVault, 'note/beta.md')

    const note = await service.appendToNote({
      path: 'note/beta.md',
      content: 'Follow-up bullet.\n',
      vaultPath: secondVault,
    })

    assert.equal(note.path, 'note/beta.md')
    assert.equal(note.vaultPath, secondVault)
    assert.equal(
      await readFile(absolutePath, 'utf-8'),
      '---\ntitle: "Beta Project"\ntype: Note\n---\n\n# Beta Project\n\nProject planning in the second vault.\nFollow-up bullet.\n',
    )
    assert.deepEqual(emittedActions, [
      { action: 'vault_changed', payload: { path: absolutePath } },
    ])
  })

  it('searches active vaults with consistent vault metadata', async () => {
    const service = makeService()

    const results = await service.searchNotes({ query: 'Project', limit: 2 })

    assert.equal(results.length, 2)
    assert.deepEqual(
      results.map(({ path: notePath, vaultPath, vaultLabel }) => ({
        notePath,
        vaultPath,
        vaultLabel,
      })),
      [
        { notePath: 'note/alpha.md', vaultPath: firstVault, vaultLabel: 'First Vault' },
        { notePath: 'note/beta.md', vaultPath: secondVault, vaultLabel: 'Second Vault' },
      ],
    )
  })

  it('lists active vaults with agent-instruction metadata', async () => {
    const service = makeService()

    assert.deepEqual(await service.listVaults(), {
      vaults: [
        {
          path: firstVault,
          label: 'First Vault',
          agentInstructionsPath: null,
          hasAgentInstructions: false,
        },
        {
          path: secondVault,
          label: 'Second Vault',
          agentInstructionsPath: path.join(secondVault, 'AGENTS.md'),
          hasAgentInstructions: true,
        },
      ],
    })
  })

  it('emits transport-neutral UI intents for note opening and filters', () => {
    const emittedActions = []
    const service = makeService({ emittedActions })

    service.openNoteAsTab({ path: 'note/beta.md', vaultPath: secondVault })
    service.openNoteInEditor({ path: 'note/beta.md', vaultPath: secondVault })
    service.highlightEditor({ element: 'editor', path: 'note/beta.md' })
    service.setFilter({ type: 'Project' })
    service.refreshVault({ path: 'note/beta.md', vaultPath: secondVault })

    assert.deepEqual(emittedActions, [
      { action: 'vault_changed', payload: { path: path.join(secondVault, 'note/beta.md') } },
      { action: 'open_tab', payload: { path: path.join(secondVault, 'note/beta.md') } },
      { action: 'vault_changed', payload: { path: path.join(secondVault, 'note/beta.md') } },
      { action: 'open_note', payload: { path: path.join(secondVault, 'note/beta.md') } },
      { action: 'highlight', payload: { element: 'editor', path: 'note/beta.md' } },
      { action: 'set_filter', payload: { filterType: 'Project' } },
      { action: 'vault_changed', payload: { path: path.join(secondVault, 'note/beta.md') } },
    ])
  })
})

function makeService({ emittedActions = [] } = {}) {
  return createMcpToolService({
    resolveVaultPaths: () => [firstVault, secondVault],
    emitUiAction: (action, payload) => {
      emittedActions.push({ action, payload })
    },
  })
}

async function seedVault(vaultPath, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(vaultPath, relativePath)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, content, 'utf-8')
  }
}

function noteFixture(title, body) {
  return `---\ntitle: ${JSON.stringify(title)}\ntype: Note\n---\n\n# ${title}\n\n${body}\n`
}
