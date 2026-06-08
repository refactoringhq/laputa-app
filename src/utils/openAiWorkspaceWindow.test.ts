import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AI_WORKSPACE_WINDOW_LABEL,
  buildAiWorkspaceWindowUrl,
  buildRuntimeAiWorkspaceWindowUrl,
  closePreloadedAiWorkspaceWindow,
  closeCurrentAiWorkspaceWindow,
  dockCurrentAiWorkspaceWindow,
  openAiWorkspaceWindow,
  preloadAiWorkspaceWindow,
  readAiWorkspaceWindowContext,
} from './openAiWorkspaceWindow'
import { isTauri } from '../mock-tauri'
import { AI_WORKSPACE_DOCK_REQUESTED_EVENT } from './aiPromptBridge'

const webviewWindowCalls = vi.fn()
const webviewGetByLabel = vi.fn()
const existingShow = vi.fn().mockResolvedValue(undefined)
const existingUnminimize = vi.fn().mockResolvedValue(undefined)
const existingSetFocus = vi.fn().mockResolvedValue(undefined)
const existingClose = vi.fn().mockResolvedValue(undefined)
const existingIsVisible = vi.fn().mockResolvedValue(true)
const emitTo = vi.fn().mockResolvedValue(undefined)
const close = vi.fn().mockResolvedValue(undefined)
const webviewListen = vi.fn()
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

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: class MockWebviewWindow {
    static getByLabel = webviewGetByLabel

    listen = webviewListen

    constructor(label: string, options: unknown) {
      webviewWindowCalls(label, options)
    }
  },
}))

vi.mock('@tauri-apps/api/event', () => ({
  emitTo,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ close }),
}))

async function runCurrentWindowAction(action: () => Promise<void>) {
  vi.mocked(isTauri).mockReturnValue(true)
  const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
  await action()
  return dispatchSpy
}

describe('openAiWorkspaceWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
    webviewGetByLabel.mockResolvedValue(null)
    existingIsVisible.mockResolvedValue(true)
    webviewListen.mockImplementation((event: string, handler: (event?: unknown) => void) => {
      const unlisten = vi.fn()
      if (event === 'tauri://created') queueMicrotask(() => handler())
      return Promise.resolve(unlisten)
    })
    localStorage.clear()
  })

  it('builds the AI workspace route', () => {
    const url = buildAiWorkspaceWindowUrl('ai-workspace', {
      activeConversationId: 'chat-1',
      vaultPath: '/tmp/vault',
      vaultPaths: ['/tmp/vault', '/tmp/other'],
    })
    const parsed = new URL(url, 'https://tolaria.localhost')

    expect(parsed.pathname).toBe('/')
    expect(parsed.searchParams.get('window')).toBe('ai-workspace')
    expect(parsed.searchParams.get('windowLabel')).toBe('ai-workspace')
    expect(parsed.searchParams.get('activeConversationId')).toBe('chat-1')
    expect(parsed.searchParams.get('vault')).toBe('/tmp/vault')
    expect(JSON.parse(parsed.searchParams.get('vaultPaths') ?? '[]')).toEqual(['/tmp/vault', '/tmp/other'])
  })

  it('reads the AI workspace route context', () => {
    const search = '?window=ai-workspace&activeConversationId=chat-1&vault=%2Ftmp%2Fvault&vaultPaths=%5B%22%2Ftmp%2Fvault%22%5D'

    expect(readAiWorkspaceWindowContext(search)).toEqual({
      activeConversationId: 'chat-1',
      vaultPath: '/tmp/vault',
      vaultPaths: ['/tmp/vault'],
    })
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

    await openAiWorkspaceWindow({ vaultPath: '/tmp/vault' })

    expect(webviewWindowCalls).toHaveBeenCalledWith(
      AI_WORKSPACE_WINDOW_LABEL,
      expect.objectContaining({
        url: expect.stringContaining('vault=%2Ftmp%2Fvault'),
        title: 'Tolaria AI',
        width: 560,
        height: 680,
        minWidth: 420,
        minHeight: 420,
        minimizable: false,
        alwaysOnTop: false,
        decorations: false,
        shadow: false,
        transparent: true,
        backgroundColor: '#00000000',
        visible: true,
      }),
    )
    expect(localStorage.getItem('tolaria:ai-workspace-window:ai-workspace')).toBe('true')
  })

  it('preloads a hidden native AI workspace window', async () => {
    vi.mocked(isTauri).mockReturnValue(true)

    await preloadAiWorkspaceWindow({ vaultPath: '/tmp/vault' })

    expect(webviewWindowCalls).toHaveBeenCalledWith(
      AI_WORKSPACE_WINDOW_LABEL,
      expect.objectContaining({
        url: expect.stringContaining('vault=%2Ftmp%2Fvault'),
        visible: false,
      }),
    )
    expect(localStorage.getItem('tolaria:ai-workspace-window:ai-workspace')).toBe('true')
  })

  it('uses manual create listeners so stale Tauri unlisten failures are swallowed', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    const staleCreatedUnlisten = vi.fn(() => {
      throw new TypeError("undefined is not an object (evaluating 'listeners[eventId].handlerId')")
    })
    const errorUnlisten = vi.fn()
    webviewListen.mockImplementation((event: string, handler: (event?: unknown) => void) => {
      if (event === 'tauri://created') queueMicrotask(() => handler())
      return Promise.resolve(event === 'tauri://created' ? staleCreatedUnlisten : errorUnlisten)
    })

    await preloadAiWorkspaceWindow()
    await Promise.resolve()

    expect(webviewListen).toHaveBeenCalledWith('tauri://created', expect.any(Function))
    expect(webviewListen).toHaveBeenCalledWith('tauri://error', expect.any(Function))
    expect(staleCreatedUnlisten).toHaveBeenCalledOnce()
    expect(errorUnlisten).toHaveBeenCalledOnce()
  })

  it('closes a hidden preloaded window', async () => {
    vi.mocked(isTauri).mockReturnValue(true)

    await preloadAiWorkspaceWindow()
    webviewGetByLabel.mockResolvedValue({ close: existingClose, isVisible: vi.fn().mockResolvedValue(false) })
    await closePreloadedAiWorkspaceWindow()

    expect(existingClose).toHaveBeenCalledOnce()
  })

  it('keeps a visible preloaded window open during cleanup', async () => {
    vi.mocked(isTauri).mockReturnValue(true)

    await preloadAiWorkspaceWindow()
    webviewGetByLabel.mockResolvedValue({ close: existingClose, isVisible: vi.fn().mockResolvedValue(true) })
    await closePreloadedAiWorkspaceWindow()

    expect(existingClose).not.toHaveBeenCalled()
  })

  it('focuses an existing AI workspace window instead of creating another', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    webviewGetByLabel.mockResolvedValue({
      show: existingShow,
      unminimize: existingUnminimize,
      setFocus: existingSetFocus,
      isVisible: existingIsVisible,
    })

    await openAiWorkspaceWindow()

    expect(existingShow).toHaveBeenCalledOnce()
    expect(existingUnminimize).toHaveBeenCalledOnce()
    expect(existingSetFocus).toHaveBeenCalledOnce()
    expect(existingIsVisible).toHaveBeenCalledTimes(2)
    expect(webviewWindowCalls).not.toHaveBeenCalled()
  })

  it('replaces a stale existing AI workspace window when it cannot be shown', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    existingIsVisible.mockResolvedValue(false)
    webviewGetByLabel.mockResolvedValue({
      show: existingShow,
      unminimize: existingUnminimize,
      setFocus: existingSetFocus,
      isVisible: existingIsVisible,
      close: existingClose,
    })

    await openAiWorkspaceWindow({ vaultPath: '/tmp/vault' })

    expect(existingClose).toHaveBeenCalledOnce()
    expect(webviewWindowCalls).toHaveBeenCalledWith(
      AI_WORKSPACE_WINDOW_LABEL,
      expect.objectContaining({
        url: expect.stringContaining('vault=%2Ftmp%2Fvault'),
        visible: true,
      }),
    )
  })

  it('closes the current AI workspace window without docking it', async () => {
    const dispatchSpy = await runCurrentWindowAction(closeCurrentAiWorkspaceWindow)

    expect(dispatchSpy).not.toHaveBeenCalledWith(expect.objectContaining({
      type: AI_WORKSPACE_DOCK_REQUESTED_EVENT,
    }))
    expect(emitTo).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
    dispatchSpy.mockRestore()
  })

  it('requests docking and closes the current AI workspace window', async () => {
    const dispatchSpy = await runCurrentWindowAction(dockCurrentAiWorkspaceWindow)

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: AI_WORKSPACE_DOCK_REQUESTED_EVENT,
    }))
    expect(emitTo).toHaveBeenCalledWith('main', AI_WORKSPACE_DOCK_REQUESTED_EVENT)
    expect(close).toHaveBeenCalledOnce()
    dispatchSpy.mockRestore()
  })
})
