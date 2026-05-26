import { useCallback, useEffect } from 'react'
import { isTauri } from '../mock-tauri'
import { trackEvent } from '../lib/telemetry'
import { SETTINGS_SECTION_IDS } from '../components/settingsSectionIds'
import {
  AI_WORKSPACE_DOCK_REQUESTED_EVENT,
  OPEN_AI_CHAT_EVENT,
} from '../utils/aiPromptBridge'
import {
  dockCurrentAiWorkspaceWindow,
  openAiWorkspaceWindow,
  type AiWorkspaceWindowContext,
} from '../utils/openAiWorkspaceWindow'

interface UseAppAiWorkspaceBridgeOptions {
  aiFeaturesEnabled: boolean
  aiWorkspaceWindow: boolean
  closeAIChat: () => void
  openAIChat: () => void
  openSettings: () => void
  setSettingsInitialSectionId: (sectionId: string | null) => void
  showAIChat: boolean
  windowContext?: AiWorkspaceWindowContext
}

interface AppAiWorkspaceBridge {
  effectiveShowAIChat: boolean
  handleDockCurrentAiWorkspaceWindow: () => void
  handleOpenAiSettings: () => void
  handleOpenDockedAiWorkspace: () => void
  handlePopOutAiWorkspace: () => void
}

type Unlisten = () => void

function listenForNativeDockRequests(handleDockRequest: () => void): Promise<Unlisten | null> | null {
  if (!isTauri()) return null

  return import('@tauri-apps/api/event')
    .then(({ listen }) => listen(AI_WORKSPACE_DOCK_REQUESTED_EVENT, handleDockRequest))
    .catch(() => null)
}

function useOpenAiChatEvent(aiFeaturesEnabled: boolean, openAIChat: () => void) {
  useEffect(() => {
    const handleOpenAiChat = () => {
      if (!aiFeaturesEnabled) return
      openAIChat()
      trackEvent('ai_workspace_open', { source: 'event' })
    }

    window.addEventListener(OPEN_AI_CHAT_EVENT, handleOpenAiChat)
    return () => window.removeEventListener(OPEN_AI_CHAT_EVENT, handleOpenAiChat)
  }, [aiFeaturesEnabled, openAIChat])
}

function useDockRequestEvent(aiFeaturesEnabled: boolean, aiWorkspaceWindow: boolean, openAIChat: () => void) {
  useEffect(() => {
    if (aiWorkspaceWindow) return

    const handleDockRequest = () => {
      if (!aiFeaturesEnabled) return
      openAIChat()
      trackEvent('ai_workspace_docked', { source: 'window' })
    }

    window.addEventListener(AI_WORKSPACE_DOCK_REQUESTED_EVENT, handleDockRequest)
    const unlistenPromise = listenForNativeDockRequests(handleDockRequest)

    return () => {
      window.removeEventListener(AI_WORKSPACE_DOCK_REQUESTED_EVENT, handleDockRequest)
      void unlistenPromise?.then((unlisten) => unlisten?.()).catch(() => undefined)
    }
  }, [aiFeaturesEnabled, aiWorkspaceWindow, openAIChat])
}

function useCloseDisabledAiWorkspace(aiFeaturesEnabled: boolean, closeAIChat: () => void, showAIChat: boolean) {
  useEffect(() => {
    if (!aiFeaturesEnabled && showAIChat) closeAIChat()
  }, [aiFeaturesEnabled, closeAIChat, showAIChat])
}

export function useAppAiWorkspaceBridge({
  aiFeaturesEnabled,
  aiWorkspaceWindow,
  closeAIChat,
  openAIChat,
  openSettings,
  setSettingsInitialSectionId,
  showAIChat,
  windowContext,
}: UseAppAiWorkspaceBridgeOptions): AppAiWorkspaceBridge {
  useOpenAiChatEvent(aiFeaturesEnabled, openAIChat)
  useCloseDisabledAiWorkspace(aiFeaturesEnabled, closeAIChat, showAIChat)
  useDockRequestEvent(aiFeaturesEnabled, aiWorkspaceWindow, openAIChat)

  const handleOpenAiSettings = useCallback(() => {
    setSettingsInitialSectionId(SETTINGS_SECTION_IDS.ai)
    openSettings()
  }, [openSettings, setSettingsInitialSectionId])

  const handleOpenDockedAiWorkspace = useCallback(() => {
    openAIChat()
    trackEvent('ai_workspace_open', { source: 'status_bar' })
  }, [openAIChat])

  const handlePopOutAiWorkspace = useCallback(() => {
    closeAIChat()
    trackEvent('ai_workspace_pop_out')
    void openAiWorkspaceWindow(windowContext)
      .then((opened) => {
        if (!opened) openAIChat()
      })
      .catch((err) => {
        console.warn('[ai] Failed to open workspace window:', err)
        openAIChat()
      })
  }, [closeAIChat, openAIChat, windowContext])

  const handleDockCurrentAiWorkspaceWindow = useCallback(() => {
    trackEvent('ai_workspace_docked', { source: 'button' })
    void dockCurrentAiWorkspaceWindow().catch((err) => {
      console.warn('[ai] Failed to dock workspace window:', err)
    })
  }, [])

  return {
    effectiveShowAIChat: aiFeaturesEnabled && showAIChat,
    handleDockCurrentAiWorkspaceWindow,
    handleOpenAiSettings,
    handleOpenDockedAiWorkspace,
    handlePopOutAiWorkspace,
  }
}
