import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AI_WORKSPACE_WINDOW_LABEL,
  buildAiWorkspaceWindowUrl,
  buildRuntimeAiWorkspaceWindowUrl,
  dockCurrentAiWorkspaceWindow,
  openAiWorkspaceWindow,
} from './openAiWorkspaceWindow'
import { isTauri } from '../mock-tauri'
import { shouldUseCustomWindowChrome } from './platform'
import { AI_WORKSPACE_DOCK_REQUESTED_EVENT } from './aiPromptBridge'

const webviewWindowCalls = vi.fn()
const webviewGetByLabel = vi.fn()
const existingUnminimize = vi.fn().mockResolvedValue(undefined)
const existingSetFocus = vi.fn().mockResolvedValue(undefined)
const emitTo = vi.fn().mockResolvedValue(undefined)
const destroy = vi.fn().mockResolvedValue(undefined)
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(),
}))

vi.mock('./platform', () => ({
  shouldUseCustomWindowChrome: vi.fn(),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: class MockWebviewWindow {
    static getByLabel = webviewGetByLabel

    constructor(label: string, options: unknown) {
      webviewWindowCalls(label, options)
    }
  },
}))

vi.mock('@tauri-apps/api/dpi', () => ({
  LogicalPosition: class MockLogicalPosition {
    constructor(public x: number, public y: number) {}
  },
}))

vi.mock('@tauri-apps/api/event', () => ({
  emitTo,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ destroy }),
}))

describe('openAiWorkspaceWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
    vi.mocked(shouldUseCustomWindowChrome).mockReturnValue(false)
    webviewGetByLabel.mockResolvedValue(null)
    localStorage.clear()
  })

  it('builds the AI workspace route', () => {
    const url = buildAiWorkspaceWindowUrl('ai-workspace')
    const parsed = new URL(url, 'https://tolaria.localhost')

    expect(parsed.pathname).toBe('/')
    expect(parsed.searchParams.get('window')).toBe('ai-workspace')
    expect(parsed.searchParams.get('windowLabel')).toBe('ai-workspace')
  })

  it('resolves the runtime route against the current app origin', () => {
    const url = buildRuntimeAiWorkspaceWindowUrl()
    const parsed = new URL(url)

    expect(parsed.origin).toBe(window.location.origin)
    expect(parsed.searchParams.get('window')).toBe('ai-workspace')
  })

  it('does nothing outside Tauri', async () => {
    await openAiWorkspaceWindow()

    expect(webviewWindowCalls).not.toHaveBeenCalled()
  })

  it('opens one native Tauri AI workspace window', async () => {
    vi.mocked(isTauri).mockReturnValue(true)

    await openAiWorkspaceWindow()

    expect(webviewWindowCalls).toHaveBeenCalledWith(
      AI_WORKSPACE_WINDOW_LABEL,
      expect.objectContaining({
        title: 'Tolaria AI',
        width: 940,
        height: 680,
        minWidth: 520,
        minHeight: 420,
        titleBarStyle: 'overlay',
        trafficLightPosition: expect.objectContaining({ x: 18, y: 22 }),
        hiddenTitle: true,
        decorations: true,
      }),
    )
    expect(localStorage.getItem('tolaria:ai-workspace-window:ai-workspace')).toBe('true')
  })

  it('focuses an existing AI workspace window instead of creating another', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    webviewGetByLabel.mockResolvedValue({
      unminimize: existingUnminimize,
      setFocus: existingSetFocus,
    })

    await openAiWorkspaceWindow()

    expect(existingUnminimize).toHaveBeenCalledOnce()
    expect(existingSetFocus).toHaveBeenCalledOnce()
    expect(webviewWindowCalls).not.toHaveBeenCalled()
  })

  it('requests docking and destroys the current AI workspace window', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    await dockCurrentAiWorkspaceWindow()

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: AI_WORKSPACE_DOCK_REQUESTED_EVENT,
    }))
    expect(emitTo).toHaveBeenCalledWith('main', AI_WORKSPACE_DOCK_REQUESTED_EVENT)
    expect(destroy).toHaveBeenCalledOnce()
    dispatchSpy.mockRestore()
  })
})
