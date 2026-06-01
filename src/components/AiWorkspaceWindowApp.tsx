import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { AppPreferencesProvider, useAppPreferences } from '../hooks/useAppPreferences'
import { useAiAgentsStatus } from '../hooks/useAiAgentsStatus'
import { useSettings } from '../hooks/useSettings'
import { useVaultAiGuidanceStatus } from '../hooks/useVaultAiGuidanceStatus'
import { isTauri } from '../mock-tauri'
import { areAiFeaturesEnabled } from '../lib/aiFeatures'
import {
  aiWorkspaceWindowSharedContextSnapshot,
  subscribeAiWorkspaceWindowSharedContext,
} from '../lib/aiWorkspaceWindowSharedContext'
import type { AiWorkspaceConversationSetting, Settings } from '../types'
import {
  AI_WORKSPACE_CONTEXT_UPDATED_EVENT,
  closeCurrentAiWorkspaceWindow,
  dockCurrentAiWorkspaceWindow,
  readAiWorkspaceWindowContext,
  type AiWorkspaceWindowContext,
} from '../utils/openAiWorkspaceWindow'
import { cleanupTauriEventListener, type TauriUnlisten } from '../utils/tauriEventCleanup'
import {
  AI_WORKSPACE_FILE_CREATED_EVENT,
  AI_WORKSPACE_FILE_MODIFIED_EVENT,
  AI_WORKSPACE_OPEN_NOTE_REQUESTED_EVENT,
  AI_WORKSPACE_VAULT_CHANGED_EVENT,
} from '../utils/aiPromptBridge'
import { AppAiWorkspaceSurface } from './AppAiWorkspaceSurface'
import { Toast } from './Toast'

const RESIZE_EDGE = 18

type ResizeDirection =
  | 'East'
  | 'North'
  | 'NorthEast'
  | 'NorthWest'
  | 'South'
  | 'SouthEast'
  | 'SouthWest'
  | 'West'

function useAiWorkspaceWindowContext() {
  const [context, setContext] = useState(() => readAiWorkspaceWindowContext())

  useEffect(() => {
    let disposed = false
    let unlisten: TauriUnlisten | undefined

    void import('@tauri-apps/api/event')
      .then(({ listen }) => listen<AiWorkspaceWindowContext>(AI_WORKSPACE_CONTEXT_UPDATED_EVENT, (event) => {
        setContext(event.payload)
      }))
      .then((nextUnlisten) => {
        if (disposed) {
          cleanupTauriEventListener(nextUnlisten)
          return
        }
        unlisten = nextUnlisten
      })
      .catch(() => undefined)

    return () => {
      disposed = true
      cleanupTauriEventListener(unlisten)
    }
  }, [])

  return context
}

function useTransparentWindowBackground() {
  useLayoutEffect(() => {
    const previousBodyBackground = document.body.style.background
    const previousRootBackground = document.documentElement.style.background
    document.documentElement.classList.add('ai-workspace-native-window')
    document.body.classList.add('ai-workspace-native-window')
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'

    return () => {
      document.documentElement.classList.remove('ai-workspace-native-window')
      document.body.classList.remove('ai-workspace-native-window')
      document.body.style.background = previousBodyBackground
      document.documentElement.style.background = previousRootBackground
    }
  }, [])
}

function useAiWorkspaceSettingsSaver(
  enabled: boolean,
  settings: Settings,
  saveSettings: (settings: Settings) => void | Promise<void>,
) {
  return useCallback((conversations: AiWorkspaceConversationSetting[]) => {
    if (!enabled) return
    void saveSettings({ ...settings, ai_workspace_conversations: conversations })
  }, [enabled, saveSettings, settings])
}

function resizeDirectionForPoint(x: number, y: number, rect: DOMRect): ResizeDirection | null {
  const nearLeft = Math.abs(x - rect.left) <= RESIZE_EDGE
  const nearRight = Math.abs(x - rect.right) <= RESIZE_EDGE
  const nearTop = Math.abs(y - rect.top) <= RESIZE_EDGE
  const nearBottom = Math.abs(y - rect.bottom) <= RESIZE_EDGE

  if (nearTop && nearLeft) return 'NorthWest'
  if (nearTop && nearRight) return 'NorthEast'
  if (nearBottom && nearLeft) return 'SouthWest'
  if (nearBottom && nearRight) return 'SouthEast'
  if (nearTop) return 'North'
  if (nearBottom) return 'South'
  if (nearLeft) return 'West'
  if (nearRight) return 'East'
  return null
}

function isInteractiveResizeTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false

  return target.closest(
    'button, [role="button"], a, input, textarea, select, [contenteditable="true"], [data-radix-popper-content-wrapper]',
  ) !== null
}

function useAiWorkspaceFrameResize() {
  useEffect(() => {
    if (!isTauri()) return

    const appWindow = getCurrentWindow()
    const startResize = (event: globalThis.MouseEvent) => {
      if (event.button !== 0) return
      if (isInteractiveResizeTarget(event.target)) return

      const frame = document.getElementById('root')
      if (!frame) return

      const direction = resizeDirectionForPoint(event.clientX, event.clientY, frame.getBoundingClientRect())
      if (!direction) return

      event.preventDefault()
      event.stopPropagation()
      void appWindow.startResizeDragging(direction).catch(() => {})
    }

    document.addEventListener('mousedown', startResize, true)
    return () => document.removeEventListener('mousedown', startResize, true)
  }, [])
}

function useAiWorkspaceWindowChrome() {
  useEffect(() => {
    if (!isTauri()) return

    const appWindow = getCurrentWindow()
    void appWindow.setAlwaysOnTop(false).catch(() => {})
    void appWindow.setShadow(false).catch(() => {})
  }, [])
}

function useMainWindowEvent<T>(eventName: string) {
  return useCallback((payload: T) => {
    if (!isTauri()) return

    void import('@tauri-apps/api/event')
      .then(({ emitTo }) => emitTo('main', eventName, payload))
      .catch(() => undefined)
  }, [eventName])
}

function useAiWorkspaceFrameCursor() {
  useEffect(() => {
    if (!isTauri()) return

    const syncCursor = (event: globalThis.MouseEvent) => {
      if (isInteractiveResizeTarget(event.target)) {
        resetCursor()
        return
      }

      const frame = document.getElementById('root')
      const direction = frame ? resizeDirectionForPoint(event.clientX, event.clientY, frame.getBoundingClientRect()) : null
      document.body.style.cursor = resizeCursorForDirection(direction)
    }

    const resetCursor = () => {
      document.body.style.cursor = ''
    }

    document.addEventListener('mousemove', syncCursor)
    document.addEventListener('mouseleave', resetCursor)
    return () => {
      document.removeEventListener('mousemove', syncCursor)
      document.removeEventListener('mouseleave', resetCursor)
      resetCursor()
    }
  }, [])
}

function resizeCursorForDirection(direction: ResizeDirection | null): string {
  switch (direction) {
    case 'North':
    case 'South':
      return 'ns-resize'
    case 'East':
    case 'West':
      return 'ew-resize'
    case 'NorthEast':
    case 'SouthWest':
      return 'nesw-resize'
    case 'NorthWest':
    case 'SouthEast':
      return 'nwse-resize'
    default:
      return ''
  }
}

export function AiWorkspaceWindowApp() {
  useTransparentWindowBackground()
  useAiWorkspaceFrameResize()
  useAiWorkspaceFrameCursor()
  useAiWorkspaceWindowChrome()
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const context = useAiWorkspaceWindowContext()
  const sharedContext = useSyncExternalStore(
    subscribeAiWorkspaceWindowSharedContext,
    aiWorkspaceWindowSharedContextSnapshot,
    aiWorkspaceWindowSharedContextSnapshot,
  )
  const { settings, loaded: settingsLoaded, saveSettings } = useSettings()
  const aiAgentsStatus = useAiAgentsStatus()
  const aiFeaturesEnabled = areAiFeaturesEnabled(settings)
  const preferences = useAppPreferences({
    aiAgentsStatus,
    onToast: setToastMessage,
    saveSettings,
    settings,
    settingsLoaded,
  })
  const vaultPath = context.vaultPath ?? sharedContext.vaultPath ?? ''
  const vaultPaths = context.vaultPaths ?? sharedContext.vaultPaths ?? (vaultPath ? [vaultPath] : [])
  const activeConversationId = context.activeConversationId ?? sharedContext.activeConversationId
  const { status: vaultAiGuidanceStatus } = useVaultAiGuidanceStatus(
    aiFeaturesEnabled && vaultPath ? vaultPath : null,
    vaultPath,
  )
  const handleConversationSettingsChange = useAiWorkspaceSettingsSaver(settingsLoaded, settings, saveSettings)
  const handleDock = useCallback(() => {
    void dockCurrentAiWorkspaceWindow().catch((err) => {
      console.warn('[ai] Failed to dock workspace window:', err)
    })
  }, [])
  const handleClose = useCallback(() => {
    void closeCurrentAiWorkspaceWindow().catch((err) => {
      console.warn('[ai] Failed to close workspace window:', err)
    })
  }, [])
  const handleOpenNote = useMainWindowEvent<string>(AI_WORKSPACE_OPEN_NOTE_REQUESTED_EVENT)
  const handleFileCreated = useMainWindowEvent<string>(AI_WORKSPACE_FILE_CREATED_EVENT)
  const handleFileModified = useMainWindowEvent<string>(AI_WORKSPACE_FILE_MODIFIED_EVENT)
  const handleVaultChanged = useMainWindowEvent<null>(AI_WORKSPACE_VAULT_CHANGED_EVENT)

  return (
    <AppPreferencesProvider dateDisplayFormat={preferences.dateDisplayFormat}>
      <div className="relative h-full w-full">
        {settingsLoaded ? (
          <AppAiWorkspaceSurface
            key={activeConversationId ?? 'default'}
            mode="window"
            open
            aiAgentsStatus={aiAgentsStatus}
            aiModelProviders={settings.ai_model_providers ?? []}
            conversationSettings={settings.ai_workspace_conversations ?? null}
            conversationSettingsReady={settingsLoaded}
            defaultAiAgent={preferences.aiAgentPreferences.defaultAiAgent}
            defaultAiTarget={preferences.aiAgentPreferences.defaultAiTarget}
            defaultAiAgentReadiness={preferences.aiAgentPreferences.defaultAiAgentReadiness}
            defaultAiAgentReady={preferences.aiAgentPreferences.defaultAiAgentReady}
            initialActiveConversationId={activeConversationId}
            activeEntry={sharedContext.activeEntry ?? null}
            activeNoteContent={sharedContext.activeNoteContent ?? null}
            entries={sharedContext.entries ?? []}
            openTabs={sharedContext.openTabs ?? []}
            noteList={sharedContext.noteList ?? []}
            noteListFilter={sharedContext.noteListFilter ?? { type: null, query: '' }}
            onClose={handleClose}
            onConversationSettingsChange={handleConversationSettingsChange}
            onDock={handleDock}
            onOpenNote={handleOpenNote}
            onUnsupportedAiPaste={setToastMessage}
            onFileCreated={handleFileCreated}
            onFileModified={handleFileModified}
            onVaultChanged={() => handleVaultChanged(null)}
            vaultAiGuidanceStatus={vaultAiGuidanceStatus}
            vaultPath={vaultPath}
            vaultPaths={vaultPaths}
            locale={preferences.appLocale}
          />
        ) : (
          <div
            className="h-full w-full bg-background"
            aria-hidden
          />
        )}
        <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
      </div>
    </AppPreferencesProvider>
  )
}
