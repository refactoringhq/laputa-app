#!/usr/bin/env node
/**
 * WebSocket bridge for Tolaria MCP tools.
 *
 * Exposes vault operations over WebSocket so the Tolaria app frontend
 * can invoke MCP tools in real-time without going through stdio.
 *
 * Port 9710: Tool bridge — Claude/AI clients call vault tools here.
 * Port 9711: UI bridge — Frontend listens for UI action broadcasts.
 *
 * Usage:
 *   VAULT_PATH=/path/to/vault WS_PORT=9710 WS_UI_PORT=9711 node ws-bridge.js
 *
 * Protocol (tool bridge):
 *   Client sends:  { "id": "req-1", "tool": "search_notes", "args": { "query": "test" } }
 *   Server sends:  { "id": "req-1", "result": { ... } }
 *   On error:      { "id": "req-1", "error": "message" }
 *
 * Protocol (UI bridge):
 *   Server broadcasts: { "type": "ui_action", "action": "open_note", "path": "..." }
 */
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import {
  createNote, getNote, searchNotes,
} from './vault.js'
import { requireVaultPaths } from './vault-path.js'
import { readAgentInstructions, vaultContextWithInstructions } from './agent-instructions.js'
import path from 'node:path'

const WS_PORT = parseInt(process.env.WS_PORT || '9710', 10)
const WS_UI_PORT = parseInt(process.env.WS_UI_PORT || '9711', 10)
const LOOPBACK_HOST = 'localhost'
const TRUSTED_UI_ORIGINS = new Set([
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
])

/** @type {WebSocketServer | null} */
let uiBridge = null
const UNKNOWN_TOOL = Symbol('unknown tool')

function activeVaultPaths() {
  return requireVaultPaths()
}

function requestedVaultPath(args = {}) {
  const requested = typeof args.vaultPath === 'string' ? args.vaultPath.trim() : ''
  if (!requested) return null
  if (!activeVaultPaths().includes(requested)) {
    throw new Error(`Vault is not active in Tolaria: ${requested}`)
  }
  return requested
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

async function getNoteFromActiveVaults(notePath, vaultPath = null) {
  const candidates = vaultPath ? [vaultPath] : activeVaultPaths()
  const matches = []
  const errors = []

  for (const candidate of candidates) {
    try {
      matches.push({ ...(await getNote(candidate, notePath)), vaultPath: candidate })
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
    results.push(...vaultResults.map((result) => ({ ...result, vaultPath })))
    if (results.length >= requestedLimit) break
  }

  return results.slice(0, requestedLimit)
}

async function activeVaultContext() {
  const roots = activeVaultPaths()
  if (roots.length === 1) return vaultContextWithInstructions(roots[0])
  return { vaults: await Promise.all(roots.map(vaultContextWithInstructions)) }
}

function broadcastUiAction(action, payload) {
  if (!uiBridge) return
  const msg = JSON.stringify({ type: 'ui_action', action, ...payload })
  for (const client of uiBridge.clients) {
    if (client.readyState === 1) client.send(msg)
  }
}


async function readNoteTool(args) {
  const note = await getNoteFromActiveVaults(args.path, requestedVaultPath(args))
  return { content: note.content, frontmatter: note.frontmatter }
}

function uiOpenNoteTool(args) {
  const targetPath = uiPath(args)
  broadcastUiAction('vault_changed', { path: targetPath })
  broadcastUiAction('open_note', { path: targetPath })
  return { ok: true }
}

function uiOpenTabTool(args) {
  const targetPath = uiPath(args)
  broadcastUiAction('vault_changed', { path: targetPath })
  broadcastUiAction('open_tab', { path: targetPath })
  return { ok: true }
}

async function createNoteTool(args = {}) {
  const notePath = notePathArg(args)
  const vaultPath = writableVaultPath(args)
  const note = await createNote(vaultPath, notePath, createNoteContent(args))
  const targetPath = uiPath({ ...args, path: note.path, vaultPath })
  broadcastUiAction('vault_changed', { path: targetPath })
  broadcastUiAction('open_tab', { path: targetPath })
  return { ok: true, path: note.path, absolutePath: note.absolutePath, vaultPath }
}

function highlightTool(args) {
  broadcastUiAction('highlight', { element: args.element, path: args.path })
  return { ok: true }
}

function uiSetFilterTool(args) {
  broadcastUiAction('set_filter', { filterType: args.type })
  return { ok: true }
}

function refreshVaultTool(args) {
  broadcastUiAction('vault_changed', { path: uiPath(args) })
  return { ok: true }
}

async function listVaultsTool() {
  return {
    vaults: await Promise.all(activeVaultPaths().map(async (vaultPath) => {
      const agentInstructions = await readAgentInstructions(vaultPath)
      return {
        path: vaultPath,
        label: path.basename(vaultPath) || vaultPath,
        agentInstructionsPath: agentInstructions?.path ?? null,
        hasAgentInstructions: agentInstructions !== null,
      }
    })),
  }
}

const TOOL_EXECUTORS = [
  ['open_note', readNoteTool],
  ['read_note', readNoteTool],
  ['create_note', createNoteTool],
  ['search_notes', (args) => searchActiveVaults(args.query, args.limit)],
  ['vault_context', () => activeVaultContext()],
  ['list_vaults', () => listVaultsTool()],
  ['ui_open_note', uiOpenNoteTool],
  ['ui_open_tab', uiOpenTabTool],
  ['ui_highlight', highlightTool],
  ['highlight_editor', highlightTool],
  ['ui_set_filter', uiSetFilterTool],
  ['refresh_vault', refreshVaultTool],
]

function callToolHandler(tool, args) {
  const executor = TOOL_EXECUTORS.find(([name]) => name === tool)?.[1]
  return executor ? executor(args) : UNKNOWN_TOOL
}

async function handleMessage(data) {
  const msg = JSON.parse(data)
  const { id, tool, args } = msg

  try {
    const result = await callToolHandler(tool, args || {})
    if (result === UNKNOWN_TOOL) {
      return { id, error: `Unknown tool: ${tool}` }
    }
    return { id, result }
  } catch (err) {
    return { id, error: err.message }
  }
}

export function isLoopbackAddress(remoteAddress) {
  return remoteAddress === '127.0.0.1'
    || remoteAddress === '::1'
    || remoteAddress === '::ffff:127.0.0.1'
}

export function isTrustedUiOrigin(origin) {
  if (!origin) return true
  if (TRUSTED_UI_ORIGINS.has(origin)) return true
  return /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/u.test(origin)
}

export function evaluateBridgeRequest({ bridgeType, origin, remoteAddress }) {
  if (!isLoopbackAddress(remoteAddress)) {
    return { ok: false, reason: 'non-local client' }
  }

  if (bridgeType === 'tool' && origin) {
    return { ok: false, reason: 'browser origins are not allowed on the tool bridge' }
  }

  if (bridgeType === 'ui' && !isTrustedUiOrigin(origin)) {
    return { ok: false, reason: 'untrusted UI origin' }
  }

  return { ok: true, reason: null }
}

function verifyBridgeRequest(bridgeType) {
  return (info, done) => {
    const verdict = evaluateBridgeRequest({
      bridgeType,
      origin: info.origin,
      remoteAddress: info.req.socket.remoteAddress,
    })

    if (!verdict.ok) {
      console.error(`[ws-bridge] Rejected ${bridgeType} bridge client: ${verdict.reason}`)
      done(false, 403, 'Forbidden')
      return
    }

    done(true)
  }
}

/**
 * Attempt to start the UI bridge WebSocket server.
 * Returns a Promise that resolves to the WebSocketServer or null if the port
 * is unavailable (e.g. another Tolaria instance owns it).
 */
export function startUiBridge(port = WS_UI_PORT) {
  return new Promise((resolve) => {
    const httpServer = createServer()

    httpServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[ws-bridge] UI bridge port ${port} already in use, disabling bridge`)
      } else {
        console.error(`[ws-bridge] UI bridge error: ${err.message}`)
      }
      resolve(null)
    })

    httpServer.listen(port, LOOPBACK_HOST, () => {
      const wss = new WebSocketServer({
        server: httpServer,
        verifyClient: verifyBridgeRequest('ui'),
      })
      wss.on('connection', (ws) => {
        console.error(`[ws-bridge] UI client connected on port ${port}`)
        // Relay: when a client sends a message, broadcast to all OTHER clients.
        // This allows the MCP stdio server (connected as a client) to reach the frontend.
        ws.on('message', (raw) => {
          for (const client of wss.clients) {
            if (client !== ws && client.readyState === 1) client.send(raw.toString())
          }
        })
      })
      uiBridge = wss
      console.error(`[ws-bridge] UI bridge listening on ws://localhost:${port}`)
      resolve(wss)
    })
  })
}

export function startBridge(port = WS_PORT) {
  const currentVaultPaths = activeVaultPaths()
  const wss = new WebSocketServer({
    port,
    host: LOOPBACK_HOST,
    verifyClient: verifyBridgeRequest('tool'),
  })

  wss.on('connection', (ws) => {
    console.error(`[ws-bridge] Client connected (vaults: ${currentVaultPaths.join(', ')})`)

    ws.on('message', async (raw) => {
      try {
        const response = await handleMessage(raw.toString())
        ws.send(JSON.stringify(response))
      } catch (err) {
        ws.send(JSON.stringify({ error: `Parse error: ${err.message}` }))
      }
    })

    ws.on('close', () => console.error('[ws-bridge] Client disconnected'))
  })

  console.error(`[ws-bridge] Listening on ws://${LOOPBACK_HOST}:${port}`)
  return wss
}

// Run directly if invoked as main module
const isMain = process.argv[1]?.endsWith('ws-bridge.js')
if (isMain) {
  try {
    activeVaultPaths()
    startUiBridge().then(() => startBridge())
  } catch (err) {
    console.error(`[ws-bridge] ${err.message}`)
    process.exit(1)
  }
}
