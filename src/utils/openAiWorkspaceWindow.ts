import { isTauri } from '../mock-tauri'
import { shouldUseCustomWindowChrome } from './platform'
import { rememberAiWorkspaceWindow } from './windowMode'
import { AI_WORKSPACE_DOCK_REQUESTED_EVENT, requestDockAiWorkspace } from './aiPromptBridge'

export const AI_WORKSPACE_WINDOW_LABEL = 'ai-workspace'

const AI_WORKSPACE_WINDOW_TITLE = 'Tolaria AI'
const MACOS_TRAFFIC_LIGHT_POSITION = { x: 18, y: 22 } as const
const APP_ORIGIN_PROTOCOLS = new Set(['http:', 'https:'])
const MINIMIZE_DOCK_POLL_MS = 250

interface AiWorkspaceDockingState {
  cancelled: boolean
  minimizeTimer: number | null
  unlistenClose: (() => void) | null
}

export function buildAiWorkspaceWindowUrl(windowLabel = AI_WORKSPACE_WINDOW_LABEL): string {
  const params = new URLSearchParams({
    window: 'ai-workspace',
    windowLabel,
  })

  return `/?${params.toString()}`
}

function resolveAiWorkspaceWindowUrlForRuntime(route: string): string {
  if (!APP_ORIGIN_PROTOCOLS.has(window.location.protocol)) return route

  return new URL(route, window.location.origin).toString()
}

export function buildRuntimeAiWorkspaceWindowUrl(windowLabel = AI_WORKSPACE_WINDOW_LABEL): string {
  return resolveAiWorkspaceWindowUrlForRuntime(buildAiWorkspaceWindowUrl(windowLabel))
}

export async function openAiWorkspaceWindow(): Promise<boolean> {
  if (!isTauri()) return false

  const { LogicalPosition } = await import('@tauri-apps/api/dpi')
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  const existingWindow = await WebviewWindow.getByLabel(AI_WORKSPACE_WINDOW_LABEL)
  if (existingWindow) {
    await existingWindow.unminimize().catch(() => {})
    await existingWindow.setFocus().catch(() => {})
    return true
  }

  rememberAiWorkspaceWindow()

  new WebviewWindow(AI_WORKSPACE_WINDOW_LABEL, {
    url: buildRuntimeAiWorkspaceWindowUrl(AI_WORKSPACE_WINDOW_LABEL),
    title: AI_WORKSPACE_WINDOW_TITLE,
    width: 940,
    height: 680,
    minWidth: 520,
    minHeight: 420,
    center: true,
    resizable: true,
    minimizable: true,
    titleBarStyle: 'overlay',
    trafficLightPosition: new LogicalPosition(MACOS_TRAFFIC_LIGHT_POSITION.x, MACOS_TRAFFIC_LIGHT_POSITION.y),
    hiddenTitle: true,
    decorations: !shouldUseCustomWindowChrome(),
  })

  return true
}

export async function dockCurrentAiWorkspaceWindow(): Promise<void> {
  requestDockAiWorkspace()

  if (!isTauri()) return

  const { emitTo } = await import('@tauri-apps/api/event')
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await emitTo('main', AI_WORKSPACE_DOCK_REQUESTED_EVENT).catch(() => {})
  await getCurrentWindow().destroy().catch(() => {})
}

function dockOnCloseRequest(currentWindow: ReturnType<typeof import('@tauri-apps/api/window').getCurrentWindow>, state: AiWorkspaceDockingState) {
  void currentWindow.onCloseRequested((event) => {
    event.preventDefault()
    void dockCurrentAiWorkspaceWindow()
  }).then((unlisten) => {
    if (state.cancelled) {
      unlisten()
      return
    }

    state.unlistenClose = unlisten
  })
}

function dockOnMinimize(currentWindow: ReturnType<typeof import('@tauri-apps/api/window').getCurrentWindow>, state: AiWorkspaceDockingState) {
  state.minimizeTimer = window.setInterval(() => {
    void currentWindow.isMinimized()
      .then((minimized) => {
        if (!minimized || state.cancelled) return

        void currentWindow.unminimize().catch(() => {})
        void dockCurrentAiWorkspaceWindow()
      })
      .catch(() => {})
  }, MINIMIZE_DOCK_POLL_MS)
}

function connectTrafficLightDocking(state: AiWorkspaceDockingState) {
  void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
    if (state.cancelled) return

    const currentWindow = getCurrentWindow()
    dockOnCloseRequest(currentWindow, state)
    dockOnMinimize(currentWindow, state)
  })
}

export function registerAiWorkspaceTrafficLightDocking(): () => void {
  if (!isTauri()) return () => {}

  const state: AiWorkspaceDockingState = {
    cancelled: false,
    minimizeTimer: null,
    unlistenClose: null,
  }
  connectTrafficLightDocking(state)

  return () => {
    state.cancelled = true
    state.unlistenClose?.()
    if (state.minimizeTimer !== null) window.clearInterval(state.minimizeTimer)
  }
}
