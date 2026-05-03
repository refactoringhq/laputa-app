import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import { createTranslator, type AppLocale } from '../lib/i18n'

export type McpStatus = 'checking' | 'installed' | 'not_installed'
type ManualConfigSnippet = string
type McpCommand =
  | 'check_mcp_status'
  | 'copy_text_to_clipboard'
  | 'get_mcp_config_snippet'
  | 'register_mcp_tools'
  | 'remove_mcp_tools'
type McpCommandResult = string
type McpStatusResponse = string
type ToastHandler = (msg: ToastMessage) => void
type ToastMessage = string
type VaultPath = string
type Translator = ReturnType<typeof createTranslator>

interface ManualMcpConfigState {
  error: ToastMessage | null
  loading: boolean
  snippet: ManualConfigSnippet | null
  vaultPath: VaultPath
}

const EMPTY_MANUAL_CONFIG: ManualMcpConfigState = {
  error: null,
  loading: false,
  snippet: null,
  vaultPath: '',
}

function tauriCall<T>(command: McpCommand, args?: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args)
}

function normalizeMcpStatus(value: McpStatusResponse | null | undefined): McpStatus {
  return value === 'installed' ? 'installed' : 'not_installed'
}

async function fetchMcpStatus(vaultPath: VaultPath): Promise<McpStatus> {
  try {
    const result = await tauriCall<McpStatusResponse>('check_mcp_status', { vaultPath })
    return normalizeMcpStatus(result)
  } catch {
    return 'not_installed'
  }
}

function connectSuccessToast(result: McpCommandResult, t: Translator): ToastMessage {
  return result === 'registered'
    ? t('mcp.toast.connected')
    : t('mcp.toast.refreshed')
}

function disconnectSuccessToast(result: McpCommandResult, t: Translator): ToastMessage {
  return result === 'removed'
    ? t('mcp.toast.disconnected')
    : t('mcp.toast.alreadyDisconnected')
}

function errorMessage(error: unknown): ToastMessage {
  return error instanceof Error ? error.message : String(error)
}

function visibleManualConfig(
  state: ManualMcpConfigState,
  vaultPath: VaultPath,
): ManualMcpConfigState {
  return state.vaultPath === vaultPath ? state : EMPTY_MANUAL_CONFIG
}

async function writeClipboardText(value: ManualConfigSnippet, t: Translator): Promise<void> {
  if (isTauri()) {
    await tauriCall('copy_text_to_clipboard', { text: value })
    return
  }

  if (!navigator.clipboard?.writeText) {
    throw new Error(t('mcp.error.clipboardUnavailable'))
  }

  await navigator.clipboard.writeText(value)
}

function useManualMcpConfig(
  vaultPath: VaultPath,
  onToastRef: MutableRefObject<ToastHandler>,
  t: Translator,
) {
  const [manualConfig, setManualConfig] = useState<ManualMcpConfigState>(EMPTY_MANUAL_CONFIG)

  const loadMcpConfigSnippet = useCallback(async () => {
    setManualConfig({ error: null, loading: true, snippet: null, vaultPath })
    try {
      const snippet = await tauriCall<ManualConfigSnippet>('get_mcp_config_snippet', { vaultPath })
      setManualConfig({ error: null, loading: false, snippet, vaultPath })
      return snippet
    } catch (error) {
      const message = errorMessage(error)
      setManualConfig({ error: message, loading: false, snippet: null, vaultPath })
      throw error
    }
  }, [vaultPath])

  const copyMcpConfig = useCallback(async () => {
    try {
      const snippet = await loadMcpConfigSnippet()
      await writeClipboardText(snippet, t)
      onToastRef.current(t('mcp.toast.configCopied'))
      return true
    } catch (error) {
      onToastRef.current(t('mcp.toast.configCopyFailed', { error: errorMessage(error) }))
      return false
    }
  }, [loadMcpConfigSnippet, onToastRef, t])

  const currentManualConfig = visibleManualConfig(manualConfig, vaultPath)

  return {
    mcpConfigSnippet: currentManualConfig.snippet,
    mcpConfigLoading: currentManualConfig.loading,
    mcpConfigError: currentManualConfig.error,
    loadMcpConfigSnippet,
    copyMcpConfig,
  }
}

/**
 * Detects whether the active vault is explicitly connected to external MCP
 * clients and exposes connect / disconnect actions.
 */
export function useMcpStatus(
  vaultPath: VaultPath,
  onToast: ToastHandler,
  locale: AppLocale = 'en',
) {
  const [status, setStatus] = useState<McpStatus>('checking')
  const t = useMemo(() => createTranslator(locale), [locale])
  const onToastRef = useRef(onToast)
  useEffect(() => { onToastRef.current = onToast })
  const manualConfigActions = useManualMcpConfig(vaultPath, onToastRef, t)

  const refreshMcpStatus = useCallback(async () => {
    const nextStatus = await fetchMcpStatus(vaultPath)
    setStatus(nextStatus)
    return nextStatus
  }, [vaultPath])

  useEffect(() => {
    let cancelled = false
    setStatus('checking') // eslint-disable-line react-hooks/set-state-in-effect -- reset to checking on vault switch

    fetchMcpStatus(vaultPath).then((nextStatus) => {
      if (!cancelled) setStatus(nextStatus)
    })

    return () => { cancelled = true }
  }, [vaultPath])

  const connectMcp = useCallback(async () => {
    setStatus('checking')
    try {
      const result = await tauriCall<string>('register_mcp_tools', { vaultPath })
      setStatus('installed')
      onToastRef.current(connectSuccessToast(result, t))
      return true
    } catch (e) {
      setStatus('not_installed')
      onToastRef.current(t('mcp.toast.setupFailed', { error: errorMessage(e) }))
      return false
    }
  }, [t, vaultPath])

  const disconnectMcp = useCallback(async () => {
    setStatus('checking')
    try {
      const result = await tauriCall<string>('remove_mcp_tools')
      setStatus('not_installed')
      onToastRef.current(disconnectSuccessToast(result, t))
      return true
    } catch (e) {
      const nextStatus = await refreshMcpStatus()
      setStatus(nextStatus)
      onToastRef.current(t('mcp.toast.disconnectFailed', { error: errorMessage(e) }))
      return false
    }
  }, [refreshMcpStatus, t])

  return {
    mcpStatus: status,
    refreshMcpStatus,
    connectMcp,
    disconnectMcp,
    ...manualConfigActions,
  }
}
