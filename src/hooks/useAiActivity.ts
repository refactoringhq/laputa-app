import { useState, useEffect, useRef, useCallback } from 'react'

export type HighlightElement = 'editor' | 'tab' | 'properties' | 'notelist' | null

export interface AiActivity {
  highlightElement: HighlightElement
  highlightPath: string | null
}

export interface AiActivityCallbacks {
  onOpenNote?: (path: string) => void
  onOpenTab?: (path: string) => void
  onSetFilter?: (type: string) => void
  onVaultChanged?: (path?: string) => void
}

const WS_UI_URL = 'ws://localhost:9711'
const HIGHLIGHT_DURATION_MS = 800
const RECONNECT_DELAY_MS = 3000

type UiActionMessage = Record<string, unknown> & {
  action: string
  type: 'ui_action'
}
type StringPayloadAction = 'open_note' | 'open_tab' | 'set_filter'
type StringPayloadCallback = 'onOpenNote' | 'onOpenTab' | 'onSetFilter'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function parseUiActionMessage(event: MessageEvent): UiActionMessage | null {
  try {
    const data = JSON.parse(String(event.data))
    if (!isRecord(data) || data.type !== 'ui_action' || typeof data.action !== 'string') return null
    return data as UiActionMessage
  } catch {
    return null
  }
}

function highlightElementFromValue(value: unknown): HighlightElement {
  if (value === 'editor' || value === 'tab' || value === 'properties' || value === 'notelist') return value
  return null
}

function useLatestAiActivityCallbacks(callbacks?: AiActivityCallbacks) {
  const callbacksRef = useRef(callbacks)
  useEffect(() => { callbacksRef.current = callbacks })
  return callbacksRef
}

function useAiHighlightState() {
  const [highlightElement, setHighlightElement] = useState<HighlightElement>(null)
  const [highlightPath, setHighlightPath] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearHighlightTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const clearHighlight = useCallback(() => {
    setHighlightElement(null)
    setHighlightPath(null)
  }, [])

  const showHighlight = useCallback((message: UiActionMessage) => {
    setHighlightElement(highlightElementFromValue(message.element))
    setHighlightPath(optionalString(message.path) ?? null)
    clearHighlightTimer()
    timerRef.current = setTimeout(clearHighlight, HIGHLIGHT_DURATION_MS)
  }, [clearHighlight, clearHighlightTimer])

  return {
    clearHighlightTimer,
    highlightElement,
    highlightPath,
    showHighlight,
  }
}

function dispatchStringPayload(value: unknown, callback?: (value: string) => void): void {
  const payload = optionalString(value)
  if (payload) callback?.(payload)
}

const STRING_PAYLOAD_CALLBACKS: Record<StringPayloadAction, StringPayloadCallback> = {
  open_note: 'onOpenNote',
  open_tab: 'onOpenTab',
  set_filter: 'onSetFilter',
}

function isStringPayloadAction(action: string): action is StringPayloadAction {
  return action === 'open_note' || action === 'open_tab' || action === 'set_filter'
}

function stringPayloadValue(message: UiActionMessage): unknown {
  return message.action === 'set_filter' ? message.filterType : message.path
}

function dispatchUiActionMessage(
  message: UiActionMessage,
  callbacksRef: ReturnType<typeof useLatestAiActivityCallbacks>,
  showHighlight: (message: UiActionMessage) => void,
): void {
  if (message.action === 'highlight') {
    showHighlight(message)
    return
  }
  if (message.action === 'vault_changed') {
    callbacksRef.current?.onVaultChanged?.(optionalString(message.path))
    return
  }
  if (!isStringPayloadAction(message.action)) return

  const callbackName = STRING_PAYLOAD_CALLBACKS[message.action]
  dispatchStringPayload(stringPayloadValue(message), callbacksRef.current?.[callbackName])
}

function useUiActionMessageHandler(
  callbacksRef: ReturnType<typeof useLatestAiActivityCallbacks>,
  showHighlight: (message: UiActionMessage) => void,
) {
  return useCallback((event: MessageEvent) => {
    const message = parseUiActionMessage(event)
    if (message) dispatchUiActionMessage(message, callbacksRef, showHighlight)
  }, [callbacksRef, showHighlight])
}

function useUiActionSocket(handleMessage: (event: MessageEvent) => void, clearHighlightTimer: () => void): void {
  useEffect(() => {
    let ws: WebSocket | null = null
    let mounted = true
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    function connect() {
      if (!mounted) return
      try {
        ws = new WebSocket(WS_UI_URL)
        ws.onmessage = handleMessage
        ws.onclose = () => {
          if (mounted) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS)
        }
        ws.onerror = () => { /* Silent — bridge may not be running */ }
      } catch {
        if (mounted) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS)
      }
    }

    connect()

    return () => {
      mounted = false
      ws?.close()
      clearHighlightTimer()
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  }, [clearHighlightTimer, handleMessage])
}

/**
 * Listens on the UI WebSocket bridge (port 9711) for UI action events
 * from the MCP server. Handles highlight, open_note, open_tab, set_filter,
 * and vault_changed actions.
 */
export function useAiActivity(callbacks?: AiActivityCallbacks): AiActivity {
  const callbacksRef = useLatestAiActivityCallbacks(callbacks)
  const {
    clearHighlightTimer,
    highlightElement,
    highlightPath,
    showHighlight,
  } = useAiHighlightState()
  const handleMessage = useUiActionMessageHandler(callbacksRef, showHighlight)

  useUiActionSocket(handleMessage, clearHighlightTimer)

  return { highlightElement, highlightPath }
}
