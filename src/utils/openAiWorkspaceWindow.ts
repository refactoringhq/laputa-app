import { isTauri } from '../mock-tauri'
import { rememberAiWorkspaceWindow } from './windowMode'
import { AI_WORKSPACE_DOCK_REQUESTED_EVENT, requestDockAiWorkspace } from './aiPromptBridge'
import { cleanupTauriEventListeners, type TauriUnlisten } from './tauriEventCleanup'

export const AI_WORKSPACE_WINDOW_LABEL = 'ai-workspace'
export const AI_WORKSPACE_CONTEXT_UPDATED_EVENT = 'ai-workspace-context-updated'

const AI_WORKSPACE_WINDOW_TITLE = 'Tolaria AI'
const APP_ORIGIN_PROTOCOLS = new Set(['http:', 'https:'])
const CREATE_TIMEOUT_MS = 4_000
const TRANSPARENT_WINDOW_BACKGROUND: [number, number, number, number] = [0, 0, 0, 0]
let preloadedContextKey: string | null = null

export interface AiWorkspaceWindowContext {
  activeConversationId?: string
  vaultPath?: string
  vaultPaths?: string[]
}

interface ExistingAiWorkspaceWindow {
  close?: () => Promise<void>
  isVisible?: () => Promise<boolean>
  listen?: (event: string, handler: (event?: unknown) => void) => Promise<TauriUnlisten>
  setAlwaysOnTop?: (alwaysOnTop: boolean) => Promise<void>
  setBackgroundColor?: (color: typeof TRANSPARENT_WINDOW_BACKGROUND) => Promise<void>
  setFocus: () => Promise<void>
  setShadow?: (enabled: boolean) => Promise<void>
  show?: () => Promise<void>
  unminimize: () => Promise<void>
}

interface AiWorkspaceWindowOptions {
  visible?: boolean
}

export function buildAiWorkspaceWindowUrl(
  windowLabel = AI_WORKSPACE_WINDOW_LABEL,
  context: AiWorkspaceWindowContext = {},
): string {
  const params = new URLSearchParams({
    window: 'ai-workspace',
    windowLabel,
  })
  if (context.activeConversationId) params.set('activeConversationId', context.activeConversationId)
  if (context.vaultPath) params.set('vault', context.vaultPath)
  if (context.vaultPaths?.length) params.set('vaultPaths', JSON.stringify(context.vaultPaths))

  return `/?${params.toString()}`
}

function resolveAiWorkspaceWindowUrlForRuntime(route: string): string {
  if (!APP_ORIGIN_PROTOCOLS.has(window.location.protocol)) return route

  return new URL(route, window.location.origin).toString()
}

export function buildRuntimeAiWorkspaceWindowUrl(
  windowLabel = AI_WORKSPACE_WINDOW_LABEL,
  context: AiWorkspaceWindowContext = {},
): string {
  return resolveAiWorkspaceWindowUrlForRuntime(buildAiWorkspaceWindowUrl(windowLabel, context))
}

export function readAiWorkspaceWindowContext(search = window.location.search): AiWorkspaceWindowContext {
  const params = new URLSearchParams(search)
  const activeConversationId = params.get('activeConversationId') ?? undefined
  const vaultPath = params.get('vault') ?? undefined
  const vaultPaths = parseVaultPathsParam(params.get('vaultPaths'))
  return { activeConversationId, vaultPath, vaultPaths }
}

function parseVaultPathsParam(raw: string | null): string[] | undefined {
  if (!raw) return undefined

  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      const paths = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      return paths.length > 0 ? paths : undefined
    }
  } catch {
    return undefined
  }

  return undefined
}

function aiWorkspaceWindowOptions(
  context: AiWorkspaceWindowContext,
  options: AiWorkspaceWindowOptions = {},
) {
  return {
    url: buildRuntimeAiWorkspaceWindowUrl(AI_WORKSPACE_WINDOW_LABEL, context),
    title: AI_WORKSPACE_WINDOW_TITLE,
    width: 560,
    height: 680,
    minWidth: 420,
    minHeight: 420,
    center: true,
    resizable: true,
    minimizable: false,
    alwaysOnTop: false,
    decorations: false,
    shadow: false,
    transparent: true,
    backgroundColor: '#00000000',
    visible: options.visible ?? true,
  }
}

function aiWorkspaceContextKey(context: AiWorkspaceWindowContext): string {
  return JSON.stringify({
    vaultPath: context.vaultPath ?? null,
    vaultPaths: context.vaultPaths ?? null,
  })
}

async function emitAiWorkspaceContext(context: AiWorkspaceWindowContext): Promise<void> {
  const { emitTo } = await import('@tauri-apps/api/event')
  await emitTo(AI_WORKSPACE_WINDOW_LABEL, AI_WORKSPACE_CONTEXT_UPDATED_EVENT, context).catch(() => {})
}

async function getExistingAiWorkspaceWindow(): Promise<ExistingAiWorkspaceWindow | null> {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  return WebviewWindow.getByLabel(AI_WORKSPACE_WINDOW_LABEL)
}

async function createAiWorkspaceWindow(
  context: AiWorkspaceWindowContext,
  options: AiWorkspaceWindowOptions = {},
): Promise<ExistingAiWorkspaceWindow> {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  return new WebviewWindow(
    AI_WORKSPACE_WINDOW_LABEL,
    aiWorkspaceWindowOptions(context, options),
  ) as ExistingAiWorkspaceWindow
}

function cleanupRegisteredListeners(
  settled: boolean,
  unlisteners: TauriUnlisten[],
  saveCleanup: (unlisteners: TauriUnlisten[]) => void,
): void {
  if (settled) {
    cleanupTauriEventListeners(unlisteners)
    return
  }
  saveCleanup(unlisteners)
}

function waitForCreated(existingWindow: ExistingAiWorkspaceWindow): Promise<void> {
  const listen = existingWindow.listen?.bind(existingWindow)
  if (!listen) return Promise.resolve()

  return new Promise((resolve, reject) => {
    let settled = false
    let cleanup: TauriUnlisten[] = []
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      cleanupTauriEventListeners(cleanup)
      if (error) {
        reject(error)
        return
      }
      resolve()
    }
    const timeout = window.setTimeout(() => finish(), CREATE_TIMEOUT_MS)
    const complete = (error?: unknown) => {
      window.clearTimeout(timeout)
      finish(error)
    }
    const saveCleanup = (unlisteners: TauriUnlisten[]) => {
      cleanup = unlisteners
    }

    void Promise.all([
      listen('tauri://created', () => complete()),
      listen('tauri://error', (event) => complete(event)),
    ]).then((unlisteners) => {
      cleanupRegisteredListeners(settled, unlisteners, saveCleanup)
    }).catch(complete)
  })
}

async function setWindowAlwaysOnTop(existingWindow: ExistingAiWorkspaceWindow, alwaysOnTop: boolean): Promise<void> {
  if (!existingWindow.setAlwaysOnTop) return
  await existingWindow.setAlwaysOnTop(alwaysOnTop).catch(() => {})
}

async function setWindowBackground(existingWindow: ExistingAiWorkspaceWindow): Promise<void> {
  if (!existingWindow.setBackgroundColor) return
  await existingWindow.setBackgroundColor(TRANSPARENT_WINDOW_BACKGROUND).catch(() => {})
}

async function setWindowShadow(existingWindow: ExistingAiWorkspaceWindow, enabled: boolean): Promise<void> {
  if (!existingWindow.setShadow) return
  await existingWindow.setShadow(enabled).catch(() => {})
}

async function showWindow(existingWindow: ExistingAiWorkspaceWindow): Promise<void> {
  if (!existingWindow.show) return
  await existingWindow.show().catch(() => {})
}

async function closeWindow(existingWindow: ExistingAiWorkspaceWindow): Promise<void> {
  if (!existingWindow.close) return
  await existingWindow.close().catch(() => {})
}

async function refreshAiWorkspaceWindowChrome(existingWindow: ExistingAiWorkspaceWindow): Promise<void> {
  await setWindowAlwaysOnTop(existingWindow, false)
  await setWindowBackground(existingWindow)
  await setWindowShadow(existingWindow, false)
}

function clearTemporaryAlwaysOnTop(existingWindow: ExistingAiWorkspaceWindow): void {
  window.setTimeout(() => {
    void setWindowAlwaysOnTop(existingWindow, false)
  }, 150)
}

async function raiseWindowTemporarily(existingWindow: ExistingAiWorkspaceWindow): Promise<void> {
  await setWindowAlwaysOnTop(existingWindow, true)
  await showWindow(existingWindow)
  clearTemporaryAlwaysOnTop(existingWindow)
}

export async function raiseAiWorkspaceWindowAboveMain(): Promise<void> {
  if (!isTauri()) return

  const existingWindow = await getExistingAiWorkspaceWindow()
  if (!existingWindow) return

  await raiseWindowTemporarily(existingWindow)
}

async function revealAiWorkspaceWindow(existingWindow: ExistingAiWorkspaceWindow): Promise<boolean> {
  await setWindowBackground(existingWindow)
  await showWindow(existingWindow)
  await existingWindow.unminimize().catch(() => {})
  await existingWindow.setFocus().catch(() => {})
  await refreshAiWorkspaceWindowChrome(existingWindow)
  return existingWindow.isVisible ? existingWindow.isVisible().catch(() => true) : true
}

async function visibleWindowState(existingWindow: ExistingAiWorkspaceWindow): Promise<boolean> {
  return existingWindow.isVisible ? existingWindow.isVisible().catch(() => true) : true
}

export async function preloadAiWorkspaceWindow(context: AiWorkspaceWindowContext = {}): Promise<boolean> {
  if (!isTauri()) return false

  const key = aiWorkspaceContextKey(context)
  const existingWindow = await getExistingAiWorkspaceWindow()
  if (existingWindow) {
    if (preloadedContextKey === key) return true
    const visible = await visibleWindowState(existingWindow)
    if (visible) return true
    await closeWindow(existingWindow)
  }

  rememberAiWorkspaceWindow()
  const window = await createAiWorkspaceWindow(context, { visible: false })
  await waitForCreated(window)
  preloadedContextKey = key
  return true
}

export async function closePreloadedAiWorkspaceWindow(): Promise<void> {
  if (!isTauri() || !preloadedContextKey) return

  const existingWindow = await getExistingAiWorkspaceWindow()
  preloadedContextKey = null
  if (!existingWindow) return
  const visible = await visibleWindowState(existingWindow)
  if (!visible) await closeWindow(existingWindow)
}

export async function openAiWorkspaceWindow(context: AiWorkspaceWindowContext = {}): Promise<boolean> {
  if (!isTauri()) return false

  const existingWindow = await getExistingAiWorkspaceWindow()
  let staleExistingWindowClosed = false
  if (existingWindow) {
    const visible = await visibleWindowState(existingWindow)
    if (!preloadedContextKey && !visible) {
      await closeWindow(existingWindow)
      staleExistingWindowClosed = true
    } else if (preloadedContextKey && preloadedContextKey !== aiWorkspaceContextKey(context)) {
      preloadedContextKey = null
      await closeWindow(existingWindow)
      staleExistingWindowClosed = true
    } else {
      preloadedContextKey = null
      const existingWindowIsVisible = await revealAiWorkspaceWindow(existingWindow).catch(() => false)
      if (existingWindowIsVisible) {
        await emitAiWorkspaceContext(context)
        return true
      }
    }
  }

  const currentWindow = staleExistingWindowClosed ? null : await getExistingAiWorkspaceWindow()
  if (currentWindow) {
    const existingWindowIsVisible = await revealAiWorkspaceWindow(currentWindow).catch(() => false)
    if (existingWindowIsVisible) {
      await emitAiWorkspaceContext(context)
      return true
    }
    await closeWindow(currentWindow)
  }

  rememberAiWorkspaceWindow()
  const window = await createAiWorkspaceWindow(context)
  await waitForCreated(window)
  await refreshAiWorkspaceWindowChrome(window)
  await emitAiWorkspaceContext(context)

  return true
}

export async function closeCurrentAiWorkspaceWindow(): Promise<void> {
  if (!isTauri()) return

  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().close().catch(() => {})
}

export async function dockCurrentAiWorkspaceWindow(): Promise<void> {
  requestDockAiWorkspace()

  if (!isTauri()) return

  const { emitTo } = await import('@tauri-apps/api/event')
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await emitTo('main', AI_WORKSPACE_DOCK_REQUESTED_EVENT).catch(() => {})
  await getCurrentWindow().close().catch(() => {})
}
