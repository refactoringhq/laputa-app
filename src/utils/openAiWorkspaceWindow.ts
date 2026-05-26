import { isTauri } from '../mock-tauri'
import { rememberAiWorkspaceWindow } from './windowMode'
import { AI_WORKSPACE_DOCK_REQUESTED_EVENT, requestDockAiWorkspace } from './aiPromptBridge'

export const AI_WORKSPACE_WINDOW_LABEL = 'ai-workspace'

const AI_WORKSPACE_WINDOW_TITLE = 'Tolaria AI'
const APP_ORIGIN_PROTOCOLS = new Set(['http:', 'https:'])

export interface AiWorkspaceWindowContext {
  vaultPath?: string
  vaultPaths?: string[]
}

export function buildAiWorkspaceWindowUrl(
  windowLabel = AI_WORKSPACE_WINDOW_LABEL,
  context: AiWorkspaceWindowContext = {},
): string {
  const params = new URLSearchParams({
    window: 'ai-workspace',
    windowLabel,
  })
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
  const vaultPath = params.get('vault') ?? undefined
  const vaultPaths = parseVaultPathsParam(params.get('vaultPaths'))
  return { vaultPath, vaultPaths }
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

export async function openAiWorkspaceWindow(context: AiWorkspaceWindowContext = {}): Promise<boolean> {
  if (!isTauri()) return false

  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  const existingWindow = await WebviewWindow.getByLabel(AI_WORKSPACE_WINDOW_LABEL)
  if (existingWindow) {
    await existingWindow.unminimize().catch(() => {})
    await existingWindow.setFocus().catch(() => {})
    return true
  }

  rememberAiWorkspaceWindow()

  new WebviewWindow(AI_WORKSPACE_WINDOW_LABEL, {
    url: buildRuntimeAiWorkspaceWindowUrl(AI_WORKSPACE_WINDOW_LABEL, context),
    title: AI_WORKSPACE_WINDOW_TITLE,
    width: 940,
    height: 680,
    minWidth: 520,
    minHeight: 420,
    center: true,
    resizable: true,
    minimizable: false,
    decorations: false,
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
