#!/usr/bin/env node
/**
 * Tolaria MCP Server — lightweight vault tools for AI agents.
 *
 * These MCP tools provide Tolaria-specific capabilities alongside each
 * app-managed agent's own Safe / Power User permission profile:
 *
 *   - search_notes: full-text search across vault notes
 *   - get_vault_context: vault structure overview (types, note count, folders)
 *   - get_note: parsed frontmatter + content (convenience over raw cat)
 *   - create_note: create a new markdown note without overwriting existing files
 *   - open_note: signal Tolaria UI to open a note as a tab
 *   - highlight_editor: visually highlight a UI element (editor, tab, etc.)
 *   - refresh_vault: trigger vault rescan so new/modified files appear
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import WebSocket from 'ws'
import { createNote, searchNotes, getNote } from './vault.js'
import { requireVaultPaths } from './vault-path.js'
import { readAgentInstructions, vaultContextWithInstructions } from './agent-instructions.js'
import path from 'node:path'

const WS_UI_PORT = parseInt(process.env.WS_UI_PORT || '9711', 10)
const WS_UI_URL = `ws://localhost:${WS_UI_PORT}`
const LOCAL_READ_ONLY_TOOL_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
})
const LOCAL_CREATE_TOOL_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
})

// Connect as a WebSocket CLIENT to the UI bridge (run by ws-bridge.js).
// The bridge relays messages to all other clients (the React frontend).
let uiSocket = null
let reconnectTimer = null
let shutdownStarted = false
const RECONNECT_INTERVAL_MS = 3000

function activeVaultPaths() {
  return requireVaultPaths()
}

function connectUiBridge() {
  if (shutdownStarted) return

  try {
    const ws = new WebSocket(WS_UI_URL)
    uiSocket = ws
    ws.on('open', () => {
      if (shutdownStarted) {
        closeUiSocket()
        return
      }
      console.error(`[mcp] Connected to UI bridge at ${WS_UI_URL}`)
    })
    ws.on('close', () => {
      if (uiSocket === ws) uiSocket = null
      scheduleUiReconnect()
    })
    ws.on('error', () => {
      // Silent — bridge may not be running yet, will retry
    })
  } catch {
    scheduleUiReconnect()
  }
}

function scheduleUiReconnect() {
  if (shutdownStarted) return

  clearUiReconnectTimer()
  reconnectTimer = setTimeout(connectUiBridge, RECONNECT_INTERVAL_MS)
  reconnectTimer.unref?.()
}

function clearUiReconnectTimer() {
  if (!reconnectTimer) return

  clearTimeout(reconnectTimer)
  reconnectTimer = null
}

function closeUiSocket() {
  const socket = uiSocket
  uiSocket = null
  if (!socket) return

  socket.removeAllListeners()
  socket.on('error', () => {})
  if (socket.readyState === WebSocket.CONNECTING) {
    socket.terminate?.()
    return
  }

  try {
    socket.close()
  } catch {
    // Ignore close races during process teardown.
  }
  socket.terminate?.()
}

function broadcastUiAction(action, payload) {
  if (!uiSocket || uiSocket.readyState !== WebSocket.OPEN) return
  uiSocket.send(JSON.stringify({ type: 'ui_action', action, ...payload }))
}

const TOOLS = [
  {
    name: 'search_notes',
    description: 'Full-text search across vault notes by title or content. Returns matching paths, titles, and snippets.',
    annotations: LOCAL_READ_ONLY_TOOL_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        limit: { type: 'number', description: 'Maximum number of results (default: 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_vault_context',
    description: 'Get vault orientation for the active Tolaria vaults: entity types, AGENTS.md instructions, note count, folders, and recent notes.',
    annotations: LOCAL_READ_ONLY_TOOL_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        vaultPath: { type: 'string', description: 'Optional target vault root. Omit to inspect all active vaults.' },
      },
    },
  },
  {
    name: 'list_vaults',
    description: 'List the current active Tolaria vaults available to MCP tools, including whether each vault has AGENTS.md instructions.',
    annotations: LOCAL_READ_ONLY_TOOL_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_note',
    description: 'Read a note with parsed YAML frontmatter and markdown content. Returns {path, frontmatter, content}.',
    annotations: LOCAL_READ_ONLY_TOOL_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the note (e.g. "project/my-project.md")' },
        vaultPath: { type: 'string', description: 'Optional target vault root when multiple vaults are active.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'create_note',
    description: 'Create a new markdown note inside an active Tolaria vault. Does not overwrite existing files. Use content for the full markdown including YAML frontmatter and H1.',
    annotations: LOCAL_CREATE_TOOL_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path inside the vault, or an absolute path inside an active vault. Must end in .md.' },
        content: { type: 'string', description: 'Full markdown note content, including YAML frontmatter when needed.' },
        title: { type: 'string', description: 'Optional title used only when content is omitted.' },
        type: { type: 'string', description: 'Optional note type used only when content is omitted.' },
        is_a: { type: 'string', description: 'Legacy alias for type, used only when content is omitted.' },
        vaultPath: { type: 'string', description: 'Optional target vault root when multiple vaults are active.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'open_note',
    description: 'Open a note in the Tolaria UI as a new tab. Use after creating or editing a note so the user can see it.',
    annotations: LOCAL_READ_ONLY_TOOL_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the note' },
        vaultPath: { type: 'string', description: 'Optional target vault root when opening a note outside the default vault.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'highlight_editor',
    description: 'Visually highlight a UI element in Tolaria (editor, tab, properties panel, or note list). The highlight auto-clears after a short delay.',
    annotations: LOCAL_READ_ONLY_TOOL_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        element: { type: 'string', enum: ['editor', 'tab', 'properties', 'notelist'], description: 'Which UI element to highlight' },
        path: { type: 'string', description: 'Optional note path to associate with the highlight' },
      },
      required: ['element'],
    },
  },
  {
    name: 'refresh_vault',
    description: 'Trigger a vault rescan so new or modified files appear immediately in the Tolaria note list.',
    annotations: LOCAL_READ_ONLY_TOOL_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Optional specific note path that changed' },
        vaultPath: { type: 'string', description: 'Optional target vault root when refreshing a note outside the default vault.' },
      },
    },
  },
]

function requestedVaultPath(args = {}) {
  const requested = typeof args.vaultPath === 'string' ? args.vaultPath.trim() : ''
  if (!requested) return null
  if (!activeVaultPaths().includes(requested)) {
    throw new Error(`Vault is not active in Tolaria: ${requested}`)
  }
  return requested
}

function vaultLabel(vaultPath) {
  return path.basename(vaultPath) || vaultPath
}

function withVaultMetadata(note, vaultPath) {
  return {
    ...note,
    vaultPath,
    vaultLabel: vaultLabel(vaultPath),
  }
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

async function searchActiveVaults(query, limit = 10) {
  const requestedLimit = Number.isFinite(limit) && limit > 0 ? limit : 10
  const results = []

  for (const vaultPath of activeVaultPaths()) {
    const vaultResults = await searchNotes(vaultPath, query, requestedLimit)
    results.push(...vaultResults.map((result) => withVaultMetadata(result, vaultPath)))
    if (results.length >= requestedLimit) break
  }

  return results.slice(0, requestedLimit)
}

async function activeVaultContext(targetVaultPath = null) {
  const roots = activeVaultPaths()
  if (targetVaultPath) return vaultContextWithInstructions(targetVaultPath)
  if (roots.length === 1) return vaultContextWithInstructions(roots[0])

  return {
    vaults: await Promise.all(roots.map(vaultContextWithInstructions)),
  }
}

function uiPath(args = {}) {
  const notePath = typeof args.path === 'string' ? args.path : ''
  if (path.isAbsolute(notePath)) return notePath
  const roots = activeVaultPaths()
  const vaultPath = requestedVaultPath(args) ?? (roots.length === 1 ? roots[0] : '')
  return vaultPath ? path.join(vaultPath, notePath) : notePath
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

function yamlScalar(value) {
  return JSON.stringify(value)
}

function fallbackCreateNoteContent(args = {}) {
  const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : path.basename(notePathArg(args), '.md')
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

async function handleSearchNotes(args) {
  const results = await searchActiveVaults(args.query, args.limit)
  const text = results.length === 0
    ? 'No matching notes found.'
    : results.map(r => `**${r.title}** (${r.vaultLabel} / ${r.path})\n${r.snippet}`).join('\n\n')
  return { content: [{ type: 'text', text }] }
}

async function handleVaultContext(args = {}) {
  const ctx = await activeVaultContext(requestedVaultPath(args))
  return { content: [{ type: 'text', text: JSON.stringify(ctx, null, 2) }] }
}

async function handleListVaults() {
  const vaults = await Promise.all(activeVaultPaths().map(async (vaultPath) => {
    const agentInstructions = await readAgentInstructions(vaultPath)
    return {
      path: vaultPath,
      label: vaultLabel(vaultPath),
      agentInstructionsPath: agentInstructions?.path ?? null,
      hasAgentInstructions: agentInstructions !== null,
    }
  }))

  return { content: [{ type: 'text', text: JSON.stringify({ vaults }, null, 2) }] }
}

async function handleGetNote(args) {
  const note = await getNoteFromActiveVaults(args.path, requestedVaultPath(args))
  return { content: [{ type: 'text', text: JSON.stringify(note, null, 2) }] }
}

async function handleCreateNote(args = {}) {
  const notePath = notePathArg(args)
  const vaultPath = writableVaultPath(args)
  const note = await createNote(vaultPath, notePath, createNoteContent(args))
  const targetPath = uiPath({ ...args, path: note.path, vaultPath })
  broadcastUiAction('vault_changed', { path: targetPath })
  broadcastUiAction('open_tab', { path: targetPath })
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ path: note.path, absolutePath: note.absolutePath, vaultPath }, null, 2),
    }],
  }
}

function handleOpenNote(args) {
  // Refresh vault first so the new/modified note appears in the note list,
  // then signal the UI to open it in a tab.
  const targetPath = uiPath(args)
  broadcastUiAction('vault_changed', { path: targetPath })
  broadcastUiAction('open_tab', { path: targetPath })
  return { content: [{ type: 'text', text: `Opening ${targetPath} in Tolaria` }] }
}

function handleHighlightEditor(args) {
  broadcastUiAction('highlight', { element: args.element, path: args.path })
  return { content: [{ type: 'text', text: `Highlighting ${args.element}` }] }
}

function handleRefreshVault(args) {
  broadcastUiAction('vault_changed', { path: uiPath(args) })
  return { content: [{ type: 'text', text: 'Vault refresh triggered' }] }
}

const TOOL_HANDLERS = new Map([
  ['search_notes', handleSearchNotes],
  ['get_vault_context', handleVaultContext],
  ['list_vaults', handleListVaults],
  ['get_note', handleGetNote],
  ['create_note', handleCreateNote],
  ['open_note', handleOpenNote],
  ['highlight_editor', handleHighlightEditor],
  ['refresh_vault', handleRefreshVault],
])

function callToolHandler(name, args) {
  const handler = TOOL_HANDLERS.get(name)
  if (!handler) throw new Error(`Unknown tool: ${name}`)
  return handler(args)
}

// --- Server setup ---

const server = new Server(
  { name: 'tolaria-mcp-server', version: '0.3.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  try {
    return await callToolHandler(name, args)
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    }
  }
})

async function shutdown(exitCode = 0) {
  if (shutdownStarted) return

  shutdownStarted = true
  clearUiReconnectTimer()
  closeUiSocket()

  try {
    await server.close()
  } catch (error) {
    console.error(`[mcp] Error while closing server: ${error.message}`)
  }

  process.exitCode = exitCode
  setImmediate(() => process.exit(exitCode))
}

async function main() {
  const transport = new StdioServerTransport()
  server.onclose = () => {
    void shutdown(0)
  }
  process.stdin.once('end', () => {
    void shutdown(0)
  })
  process.stdin.once('close', () => {
    void shutdown(0)
  })
  process.once('SIGINT', () => {
    void shutdown(0)
  })
  process.once('SIGTERM', () => {
    void shutdown(0)
  })

  connectUiBridge()
  await server.connect(transport)
  console.error('Tolaria MCP server running (vaults resolved per call)')
}

main().catch((error) => {
  console.error(error)
  void shutdown(1)
})
