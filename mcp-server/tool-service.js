import path from 'node:path'
import {
  appendToNote as appendVaultNote,
  createNote as createVaultNote,
  getNote,
  searchNotes as searchVaultNotes,
  updateNote as updateVaultNote,
} from './vault.js'
import { requireVaultPaths } from './vault-path.js'
import { readAgentInstructions, vaultContextWithInstructions } from './agent-instructions.js'

export function createMcpToolService({
  resolveVaultPaths = () => requireVaultPaths(),
  emitUiAction = () => {},
} = {}) {
  function activeVaultPaths() {
    return resolveVaultPaths()
  }

  function requestedVaultPath(args = {}) {
    const requested = typeof args.vaultPath === 'string' ? args.vaultPath.trim() : ''
    if (!requested) return null
    if (!activeVaultPaths().includes(requested)) {
      throw new Error(`Vault is not active in Tolaria: ${requested}`)
    }
    return requested
  }

  function resolveUiPath(args = {}) {
    const notePath = typeof args.path === 'string' ? args.path : ''
    if (path.isAbsolute(notePath)) return notePath
    const roots = activeVaultPaths()
    const vaultPath = requestedVaultPath(args) ?? (roots.length === 1 ? roots[0] : '')
    return vaultPath ? path.join(vaultPath, notePath) : notePath
  }

  async function readNote(args = {}) {
    return getNoteFromActiveVaults(notePathArg(args), requestedVaultPath(args))
  }

  async function searchNotes(args = {}) {
    const requestedLimit = Number.isFinite(args.limit) && args.limit > 0 ? args.limit : 10
    const results = []

    for (const vaultPath of activeVaultPaths()) {
      const vaultResults = await searchVaultNotes(vaultPath, args.query, requestedLimit)
      results.push(...vaultResults.map((result) => withVaultMetadata(result, vaultPath)))
      if (results.length >= requestedLimit) break
    }

    return results.slice(0, requestedLimit)
  }

  async function vaultContext(args = {}) {
    const targetVaultPath = requestedVaultPath(args)
    const roots = activeVaultPaths()
    if (targetVaultPath) return vaultContextWithInstructions(targetVaultPath)
    if (roots.length === 1) return vaultContextWithInstructions(roots[0])

    return {
      vaults: await Promise.all(roots.map(vaultContextWithInstructions)),
    }
  }

  async function listVaults() {
    const vaults = await Promise.all(activeVaultPaths().map(async (vaultPath) => {
      const agentInstructions = await readAgentInstructions(vaultPath)
      return {
        path: vaultPath,
        label: vaultLabel(vaultPath),
        agentInstructionsPath: agentInstructions?.path ?? null,
        hasAgentInstructions: agentInstructions !== null,
      }
    }))

    return { vaults }
  }

  async function createNote(args = {}) {
    const vaultPath = writableVaultPath(args)
    const notePath = writableNotePath(args, vaultPath)
    const note = await createVaultNote(vaultPath, notePath, createNoteContent(args))
    const targetPath = resolveUiPath({ ...args, path: note.path, vaultPath })
    emitUiAction('vault_changed', { path: targetPath })
    emitUiAction('open_tab', { path: targetPath })
    return { path: note.path, absolutePath: note.absolutePath, vaultPath }
  }

  async function updateNote(args = {}) {
    const { vaultPath, notePath } = await resolveWritableNote(args)
    const note = await updateVaultNote(vaultPath, notePath, noteContent(args), {
      expectedMtime: args.expectedMtime,
    })
    emitUiAction('vault_changed', { path: resolveUiPath({ ...args, path: note.path, vaultPath }) })
    return { path: note.path, absolutePath: note.absolutePath, vaultPath, mtimeMs: note.mtimeMs }
  }

  async function appendToNote(args = {}) {
    const { vaultPath, notePath } = await resolveWritableNote(args)
    const note = await appendVaultNote(vaultPath, notePath, noteContent(args))
    emitUiAction('vault_changed', { path: resolveUiPath({ ...args, path: note.path, vaultPath }) })
    return { path: note.path, absolutePath: note.absolutePath, vaultPath, mtimeMs: note.mtimeMs }
  }

  async function resolveWritableNote(args = {}) {
    const vaultPath = writableVaultPath(args)
    const notePath = writableNotePath(args, vaultPath)
    return { vaultPath, notePath }
  }

  function openNoteAsTab(args = {}) {
    const targetPath = resolveUiPath(args)
    emitUiAction('vault_changed', { path: targetPath })
    emitUiAction('open_tab', { path: targetPath })
    return { targetPath }
  }

  function openNoteInEditor(args = {}) {
    const targetPath = resolveUiPath(args)
    emitUiAction('vault_changed', { path: targetPath })
    emitUiAction('open_note', { path: targetPath })
    return { targetPath }
  }

  function highlightEditor(args = {}) {
    emitUiAction('highlight', { element: args.element, path: args.path })
  }

  function setFilter(args = {}) {
    emitUiAction('set_filter', { filterType: args.type })
  }

  function refreshVault(args = {}) {
    emitUiAction('vault_changed', { path: resolveUiPath(args) })
  }

  async function getNoteFromActiveVaults(notePath, vaultPath = null) {
    const candidates = vaultPath ? [vaultPath] : activeVaultPaths()
    const matches = []
    const errors = []

    for (const candidate of candidates) {
      try {
        matches.push(withVaultMetadata(await getNote(candidate, notePath), candidate))
      } catch (error) {
        errors.push(error)
      }
    }

    if (matches.length === 1) return matches[0]
    if (matches.length > 1) {
      throw new Error(`Note path is ambiguous across active vaults. Pass vaultPath for ${notePath}.`)
    }
    throw errors[0] ?? new Error(`Note not found: ${notePath}`)
  }

  function writableVaultPath(args = {}) {
    const requested = requestedVaultPath(args)
    if (requested) return requested

    const roots = activeVaultPaths()
    const notePath = notePathArg(args)
    if (path.isAbsolute(notePath)) {
      const root = roots.find(vaultPath => isInsideVaultRoot(vaultPath, notePath))
      if (root) return root
    }
    if (roots.length === 1) return roots[0]
    throw new Error(`Note path is ambiguous across active vaults. Pass vaultPath for ${notePath}.`)
  }

  return {
    activeVaultPaths,
    appendToNote,
    createNote,
    highlightEditor,
    listVaults,
    openNoteAsTab,
    openNoteInEditor,
    readNote,
    refreshVault,
    requestedVaultPath,
    resolveUiPath,
    searchNotes,
    setFilter,
    updateNote,
    vaultContext,
  }
}

function writableNotePath(args, vaultPath) {
  const notePath = notePathArg(args)
  if (!path.isAbsolute(notePath) || !isInsideVaultRoot(vaultPath, notePath)) return notePath
  return path.relative(vaultPath, notePath)
}

function withVaultMetadata(note, vaultPath) {
  return {
    ...note,
    vaultPath,
    vaultLabel: vaultLabel(vaultPath),
  }
}

function vaultLabel(vaultPath) {
  return path.basename(vaultPath) || vaultPath
}

function isInsideVaultRoot(vaultPath, notePath) {
  const relative = path.relative(vaultPath, notePath)
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function notePathArg(args = {}) {
  const notePath = typeof args.path === 'string' ? args.path.trim() : ''
  if (!notePath) throw new Error('Note path is required')
  return notePath
}

function yamlScalar(value) {
  return JSON.stringify(value)
}

function fallbackCreateNoteContent(args = {}) {
  const title = typeof args.title === 'string' && args.title.trim()
    ? args.title.trim()
    : path.basename(notePathArg(args), '.md')
  const type = typeof args.type === 'string' && args.type.trim()
    ? args.type.trim()
    : typeof args.is_a === 'string' && args.is_a.trim()
      ? args.is_a.trim()
      : 'Note'
  return `---\ntype: ${yamlScalar(type)}\n---\n\n# ${title}\n`
}

function createNoteContent(args = {}) {
  return typeof args.content === 'string' && args.content.trim()
    ? args.content
    : fallbackCreateNoteContent(args)
}

function noteContent(args = {}) {
  if (typeof args.content === 'string' && args.content.length > 0) return args.content
  throw new Error('content is required')
}
