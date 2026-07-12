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
 *   - update_note: replace the full content of an existing note (optional conflict guard)
 *   - append_to_note: append markdown to an existing note body
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
import { createMcpToolService } from './tool-service.js'

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
const LOCAL_UPDATE_TOOL_ANNOTATIONS = LOCAL_CREATE_TOOL_ANNOTATIONS

// Connect as a WebSocket CLIENT to the UI bridge (run by ws-bridge.js).
// The bridge relays messages to all other clients (the React frontend).
let uiSocket = null
let reconnectTimer = null
let shutdownStarted = false
const RECONNECT_INTERVAL_MS = 3000

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

const toolService = createMcpToolService({ emitUiAction: broadcastUiAction })

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
    description: 'Read a note with parsed YAML frontmatter, markdown content, and mtimeMs for conflict-guarded edits. Returns {path, frontmatter, content, mtimeMs}.',
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
    name: 'update_note',
    description: 'Replace the full content (frontmatter + body) of an existing note. The note must already exist — use create_note for new notes. Optionally pass expectedMtime (the note mtimeMs returned by get_note) to fail-fast when the note changed between read and write.',
    annotations: LOCAL_UPDATE_TOOL_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path inside the vault, or an absolute path inside an active vault.' },
        content: { type: 'string', description: 'Full new markdown note content (frontmatter + body).' },
        expectedMtime: { type: 'number', description: 'Optional on-disk mtimeMs from get_note. When set, the update fails if the note has changed.' },
        vaultPath: { type: 'string', description: 'Optional target vault root when multiple vaults are active.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'append_to_note',
    description: 'Append markdown to the end of an existing note body. Lower-risk than update_note for agents that only need to log or extend content. The note must already exist.',
    annotations: LOCAL_UPDATE_TOOL_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path inside the vault, or an absolute path inside an active vault.' },
        content: { type: 'string', description: 'Markdown to append after the existing body.' },
        vaultPath: { type: 'string', description: 'Optional target vault root when multiple vaults are active.' },
      },
      required: ['path', 'content'],
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

async function handleSearchNotes(args) {
  const results = await toolService.searchNotes(args)
  const text = results.length === 0
    ? 'No matching notes found.'
    : results.map(r => `**${r.title}** (${r.vaultLabel} / ${r.path})\n${r.snippet}`).join('\n\n')
  return { content: [{ type: 'text', text }] }
}

async function handleVaultContext(args = {}) {
  const ctx = await toolService.vaultContext(args)
  return { content: [{ type: 'text', text: JSON.stringify(ctx, null, 2) }] }
}

async function handleListVaults() {
  return { content: [{ type: 'text', text: JSON.stringify(await toolService.listVaults(), null, 2) }] }
}

async function handleGetNote(args) {
  const note = await toolService.readNote(args)
  return { content: [{ type: 'text', text: JSON.stringify(note, null, 2) }] }
}

async function handleCreateNote(args = {}) {
  const note = await toolService.createNote(args)
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(note, null, 2),
    }],
  }
}

async function handleUpdateNote(args = {}) {
  const note = await toolService.updateNote(args)
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(note, null, 2),
    }],
  }
}

async function handleAppendToNote(args = {}) {
  const note = await toolService.appendToNote(args)
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(note, null, 2),
    }],
  }
}

function handleOpenNote(args) {
  // Refresh vault first so the new/modified note appears in the note list,
  // then signal the UI to open it in a tab.
  const { targetPath } = toolService.openNoteAsTab(args)
  return { content: [{ type: 'text', text: `Opening ${targetPath} in Tolaria` }] }
}

function handleHighlightEditor(args) {
  toolService.highlightEditor(args)
  return { content: [{ type: 'text', text: `Highlighting ${args.element}` }] }
}

function handleRefreshVault(args) {
  toolService.refreshVault(args)
  return { content: [{ type: 'text', text: 'Vault refresh triggered' }] }
}

const TOOL_HANDLERS = new Map([
  ['search_notes', handleSearchNotes],
  ['get_vault_context', handleVaultContext],
  ['list_vaults', handleListVaults],
  ['get_note', handleGetNote],
  ['create_note', handleCreateNote],
  ['update_note', handleUpdateNote],
  ['append_to_note', handleAppendToNote],
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
