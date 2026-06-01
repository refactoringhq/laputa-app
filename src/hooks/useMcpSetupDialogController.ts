import { useCallback, useState } from 'react'
import { useMcpStatus } from './useMcpStatus'
import type { AppLocale } from '../lib/i18n'

type ToastHandler = (message: string) => void
type McpDialogAction = 'connect' | 'disconnect' | null

export function useMcpSetupDialogController(
  vaultPath: string,
  onToast: ToastHandler,
  locale: AppLocale,
) {
  const [open, setOpen] = useState(false)
  const [busyAction, setBusyAction] = useState<McpDialogAction>(null)
  const {
    mcpStatus,
    connectMcp,
    disconnectMcp,
    mcpConfigSnippet,
    mcpConfigLoading,
    mcpConfigError,
    loadMcpConfigSnippet,
    copyMcpConfig,
  } = useMcpStatus(vaultPath, onToast, locale)

  const openDialog = useCallback(() => {
    setOpen(true)
  }, [])

  const closeDialog = useCallback(() => {
    if (busyAction !== null) return
    setOpen(false)
  }, [busyAction])

  const connect = useCallback(async () => {
    setBusyAction('connect')
    try {
      const didConnect = await connectMcp()
      if (didConnect) setOpen(false)
    } finally {
      setBusyAction(null)
    }
  }, [connectMcp])

  const disconnect = useCallback(async () => {
    setBusyAction('disconnect')
    try {
      const didDisconnect = await disconnectMcp()
      if (didDisconnect) setOpen(false)
    } finally {
      setBusyAction(null)
    }
  }, [disconnectMcp])

  const copyManualConfig = useCallback(() => {
    void copyMcpConfig()
  }, [copyMcpConfig])

  const loadManualConfig = useCallback(() => {
    void loadMcpConfigSnippet().catch(() => undefined)
  }, [loadMcpConfigSnippet])

  return {
    busyAction,
    closeDialog,
    connect,
    copyManualConfig,
    disconnect,
    loadManualConfig,
    manualConfigError: mcpConfigError,
    manualConfigLoading: mcpConfigLoading,
    manualConfigSnippet: mcpConfigSnippet,
    open,
    openDialog,
    status: mcpStatus,
  }
}
