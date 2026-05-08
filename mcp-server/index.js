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
import { existsSync } from 'node:fs'
import WebSocket from 'ws'
import { searchNotes, getNote, vaultContext } from './vault.js'
import { resolveVaultPath, loadVaultList } from './vault-path.js'

// Session-local vault override — set by switch_vault, cleared on process exit.
// Never persisted, never affects Tolaria UI (D7).
let sessionVaultOverride = null
const WS_UI_PORT = Number.parseInt(process.env.WS_UI_PORT || '9711', 10)
const WS_UI_URL = `ws://localhost:${WS_UI_PORT}`

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

const TOOLS = [
  {
    name: 'search_notes',
    description: 'Full-text search across vault notes by title or content. Returns matching paths, titles, and snippets.',
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
    name: 'list_vaults',
    description: 'List all configured Tolaria vaults with their labels, paths, and active status. Use switch_vault to change which vault subsequent tool calls operate on.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'switch_vault',
    description: 'Switch to a different vault for this session. Only affects this MCP connection — does not change the Tolaria app. Use list_vaults to see available vaults first.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the vault (from list_vaults)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_vault_context',
    description: 'Get vault orientation: entity types, total note count, top-level folders, and 20 most recently modified notes.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_note',
    description: 'Read a note with parsed YAML frontmatter and markdown content. Returns {path, frontmatter, content}.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the note (e.g. "project/my-project.md")' },
      },
      required: ['path'],
    },
  },
  {
    name: 'open_note',
    description: 'Open a note in the Tolaria UI as a new tab. Use after creating or editing a note so the user can see it.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the note' },
      },
      required: ['path'],
    },
  },
  {
    name: 'highlight_editor',
    description: 'Visually highlight a UI element in Tolaria (editor, tab, properties panel, or note list). The highlight auto-clears after a short delay.',
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
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Optional specific note path that changed' },
      },
    },
  },
]

function currentVaultPath() {
  return resolveVaultPath(sessionVaultOverride)
}

async function handleSearchNotes(args) {
  const results = await searchNotes(currentVaultPath(), args.query, args.limit)
  const text = results.length === 0
    ? 'No matching notes found.'
    : results.map(r => `**${r.title}** (${r.path})\n${r.snippet}`).join('\n\n')
  return { content: [{ type: 'text', text }] }
}

function handleListVaults() {
  const list = loadVaultList()
  if (!list || list.vaults.length === 0) {
    return { content: [{ type: 'text', text: 'No vaults configured. Open a vault in Tolaria first.' }] }
  }

  const currentPath = sessionVaultOverride
    || process.env.VAULT_PATH?.trim()
    || list.activeVault

  const vaults = list.vaults.map(v => ({
    path: v.path,
    label: v.label,
    alias: v.alias,
    active: v.path === currentPath,
  }))

  return { content: [{ type: 'text', text: JSON.stringify({ vaults }, null, 2) }] }
}

function handleSwitchVault(args) {
  const vaultPath = args.path?.trim()
  if (!vaultPath) {
    throw new Error('Vault path is required')
  }
  if (!existsSync(vaultPath)) {
    throw new Error(`Vault path does not exist: ${vaultPath}`)
  }

  sessionVaultOverride = vaultPath
  return {
    content: [{
      type: 'text',
      text: `Switched to vault: ${vaultPath}. All subsequent tool calls will use this vault.`,
    }],
  }
}

async function handleVaultContext() {
  const ctx = await vaultContext(currentVaultPath())
  return { content: [{ type: 'text', text: JSON.stringify(ctx, null, 2) }] }
}

async function handleGetNote(args) {
  const note = await getNote(currentVaultPath(), args.path)
  return { content: [{ type: 'text', text: JSON.stringify(note, null, 2) }] }
}

function handleOpenNote(args) {
  // Refresh vault first so the new/modified note appears in the note list,
  // then signal the UI to open it in a tab.
  broadcastUiAction('vault_changed', { path: args.path })
  broadcastUiAction('open_tab', { path: args.path })
  return { content: [{ type: 'text', text: `Opening ${args.path} in Tolaria` }] }
}

function handleHighlightEditor(args) {
  broadcastUiAction('highlight', { element: args.element, path: args.path })
  return { content: [{ type: 'text', text: `Highlighting ${args.element}` }] }
}

function handleRefreshVault(args) {
  broadcastUiAction('vault_changed', { path: args?.path })
  return { content: [{ type: 'text', text: 'Vault refresh triggered' }] }
}

function callToolHandler(name, args) {
  switch (name) {
    case 'search_notes':
      return handleSearchNotes(args)
    case 'list_vaults':
      return handleListVaults()
    case 'switch_vault':
      return handleSwitchVault(args)
    case 'get_vault_context':
      return handleVaultContext()
    case 'get_note':
      return handleGetNote(args)
    case 'open_note':
      return handleOpenNote(args)
    case 'highlight_editor':
      return handleHighlightEditor(args)
    case 'refresh_vault':
      return handleRefreshVault(args)
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
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
  console.error('[mcp] Tolaria MCP server running (vault resolved per call)')
}

main().catch((error) => {
  console.error(error)
  void shutdown(1)
})
