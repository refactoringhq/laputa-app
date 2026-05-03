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
  getNote, searchNotes, vaultContext,
} from './vault.js'
import { requireVaultPath } from './vault-path.js'

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
let vaultPath = null

function activeVaultPath() {
  vaultPath ??= requireVaultPath()
  return vaultPath
}

function broadcastUiAction(action, payload) {
  if (!uiBridge) return
  const msg = JSON.stringify({ type: 'ui_action', action, ...payload })
  for (const client of uiBridge.clients) {
    if (client.readyState === 1) client.send(msg)
  }
}


const TOOL_HANDLERS = {
  open_note: (args) => getNote(activeVaultPath(), args.path).then(note => ({ content: note.content, frontmatter: note.frontmatter })),
  read_note: (args) => getNote(activeVaultPath(), args.path).then(note => ({ content: note.content, frontmatter: note.frontmatter })),
  search_notes: (args) => searchNotes(activeVaultPath(), args.query, args.limit),
  vault_context: () => vaultContext(activeVaultPath()),
  ui_open_note: (args) => { broadcastUiAction('vault_changed', { path: args.path }); broadcastUiAction('open_note', { path: args.path }); return { ok: true } },
  ui_open_tab: (args) => { broadcastUiAction('vault_changed', { path: args.path }); broadcastUiAction('open_tab', { path: args.path }); return { ok: true } },
  ui_highlight: (args) => { broadcastUiAction('highlight', { element: args.element, path: args.path }); return { ok: true } },
  ui_set_filter: (args) => { broadcastUiAction('set_filter', { filterType: args.type }); return { ok: true } },
  highlight_editor: (args) => { broadcastUiAction('highlight', { element: args.element, path: args.path }); return { ok: true } },
  refresh_vault: (args) => { broadcastUiAction('vault_changed', { path: args?.path }); return { ok: true } },
}

async function handleMessage(data) {
  const msg = JSON.parse(data)
  const { id, tool, args } = msg

  const handler = TOOL_HANDLERS[tool]
  if (!handler) {
    return { id, error: `Unknown tool: ${tool}` }
  }

  try {
    const result = await handler(args || {})
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
  const currentVaultPath = activeVaultPath()
  const wss = new WebSocketServer({
    port,
    host: LOOPBACK_HOST,
    verifyClient: verifyBridgeRequest('tool'),
  })

  wss.on('connection', (ws) => {
    console.error(`[ws-bridge] Client connected (vault: ${currentVaultPath})`)

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
    activeVaultPath()
    startUiBridge().then(() => startBridge())
  } catch (err) {
    console.error(`[ws-bridge] ${err.message}`)
    process.exit(1)
  }
}
