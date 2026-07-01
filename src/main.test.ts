import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Children, createElement, isValidElement, type ReactNode } from 'react'

type ReactRootErrorInfo = { componentStack?: string }
type ReactRootOptions = {
  onCaughtError?: (error: unknown, errorInfo: ReactRootErrorInfo) => void
  onUncaughtError?: (error: unknown, errorInfo: ReactRootErrorInfo) => void
  onRecoverableError?: (error: unknown, errorInfo: ReactRootErrorInfo) => void
}

const MAIN_ENTRYPOINT_IMPORT_TIMEOUT_MS = 120_000

const mocks = vi.hoisted(() => {
  const render = vi.fn()
  const createRoot = vi.fn(() => ({ render }))
  const sentryHandler = vi.fn()
  const reactErrorHandler = vi.fn(() => sentryHandler)
  const getShortcutEventInit = vi.fn(() => ({ key: 'x' }))
  const loadAppModule = vi.fn()
  const renderApp = vi.fn()

  return {
    createRoot,
    getShortcutEventInit,
    loadAppModule,
    renderApp,
    reactErrorHandler,
    render,
    sentryHandler,
  }
})

vi.mock('react-dom/client', () => ({ createRoot: mocks.createRoot }))
vi.mock('@sentry/react', () => ({ reactErrorHandler: mocks.reactErrorHandler }))
vi.mock('./App.tsx', () => ({
  default: (() => {
    mocks.loadAppModule()
    return () => {
      mocks.renderApp()
      return createElement('div', { 'data-testid': 'mock-app' })
    }
  })(),
}))
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}))
vi.mock('./hooks/appCommandDispatcher', () => ({
  APP_COMMAND_EVENT_NAME: 'laputa:command',
  isAppCommandId: (id: string) => id === 'known-command',
  isNativeMenuCommandId: (id: string) => id === 'native-command',
}))
vi.mock('./hooks/appCommandCatalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hooks/appCommandCatalog')>()
  return {
    ...actual,
    getShortcutEventInit: mocks.getShortcutEventInit,
  }
})

async function importEntrypoint() {
  await import('./main')
}

async function withUserAgent<T>(userAgent: string, callback: () => Promise<T>): Promise<T> {
  const originalUserAgent = navigator.userAgent
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true })
  try {
    return await callback()
  } finally {
    Object.defineProperty(window.navigator, 'userAgent', { value: originalUserAgent, configurable: true })
  }
}

function createDragEventWithDataTransfer(
  type: 'dragover' | 'drop',
  dataTransfer: Partial<DataTransfer>,
): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
  Object.defineProperty(event, 'dataTransfer', {
    value: dataTransfer,
  })
  return event
}

function createFileDataTransfer(): Partial<DataTransfer> {
  return {
    files: { length: 1 } as FileList,
    items: { length: 0 } as DataTransferItemList,
    types: ['Files'],
  }
}

function dispatchFileDragEvent(target: EventTarget, type: 'dragover' | 'drop'): DragEvent {
  const event = createDragEventWithDataTransfer(type, createFileDataTransfer())
  target.dispatchEvent(event)
  return event
}

function rootOptions(): ReactRootOptions {
  const options = mocks.createRoot.mock.calls[0]?.[1]
  if (!options) throw new Error('createRoot was not called with root options')
  return options
}

function renderedTree(): ReactNode {
  const tree = mocks.render.mock.calls[0]?.[0]
  if (!tree) throw new Error('React root was not rendered')
  return tree
}

function hasElementTypeName(node: ReactNode, name: string): boolean {
  if (!isValidElement<{ children?: ReactNode }>(node)) return false

  const typeName = typeof node.type === 'function' ? node.type.name : ''
  if (typeName === name) return true

  return Children.toArray(node.props.children).some((child) =>
    hasElementTypeName(child, name),
  )
}

describe('main entrypoint', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    document.body.innerHTML = '<div id="root"></div>'
    document.body.className = ''
    window.__tolariaFrontendReady = false
    sessionStorage.clear()
  })

  it('captures React root errors through Sentry with component stack context', async () => {
    await importEntrypoint()

    expect(mocks.reactErrorHandler).toHaveBeenCalledOnce()
    expect(mocks.createRoot).toHaveBeenCalledWith(
      document.getElementById('root'),
      expect.objectContaining({
        onCaughtError: expect.any(Function),
        onUncaughtError: expect.any(Function),
        onRecoverableError: expect.any(Function),
      }),
    )

    const error = new Error('Maximum update depth exceeded')
    window.__tolariaFrontendReady = true
    rootOptions().onCaughtError?.(error, { componentStack: '\n    in App' })

    expect(mocks.sentryHandler).toHaveBeenCalledWith(error, { componentStack: '\n    in App' })
  }, MAIN_ENTRYPOINT_IMPORT_TIMEOUT_MS)

  it('normalizes missing React component stacks before handing errors to Sentry', async () => {
    await importEntrypoint()

    const error = new Error('recoverable render error')
    window.__tolariaFrontendReady = true
    rootOptions().onRecoverableError?.(error, {})

    expect(mocks.sentryHandler).toHaveBeenCalledWith(error, { componentStack: '' })
  }, MAIN_ENTRYPOINT_IMPORT_TIMEOUT_MS)

  it('marks macOS chrome for traffic-light layout offsets', async () => {
    await withUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 Safari/605.1.15', async () => {
      await importEntrypoint()
    })

    expect(document.body).toHaveClass('mac-chrome')
  }, MAIN_ENTRYPOINT_IMPORT_TIMEOUT_MS)

  it('ignores ResizeObserver loop notifications instead of showing the fatal overlay', async () => {
    await importEntrypoint()

    const error = new Error('ResizeObserver loop completed with undelivered notifications.')
    window.__tolariaFrontendReady = true

    rootOptions().onRecoverableError?.(error, {})
    rootOptions().onCaughtError?.(error, { componentStack: '\n    in App' })

    expect(mocks.sentryHandler).not.toHaveBeenCalled()
    expect(document.getElementById('tolaria-fatal-render-error')).toBeNull()
  })

  it('suppresses recovered BlockNote missing-id render errors from Sentry', async () => {
    await importEntrypoint()

    const error = new Error("Block doesn't have id")
    const componentStack = '\n    in MermaidBlock\n    in BlockNoteRenderRecoveryBoundary'
    window.__tolariaFrontendReady = true

    rootOptions().onCaughtError?.(error, { componentStack })
    expect(mocks.sentryHandler).not.toHaveBeenCalled()

    rootOptions().onUncaughtError?.(error, { componentStack })
    expect(mocks.sentryHandler).toHaveBeenCalledWith(error, { componentStack })
  })

  it('suppresses recovered BlockNote stale block-reference render errors from Sentry', async () => {
    await importEntrypoint()

    const error = new Error('Block with ID 669f337a-dee2-4d92-b5cb-9a4e9828ecf9 not found')
    const componentStack = '\n    in BlockNoteView\n    in BlockNoteRenderRecoveryBoundary'
    window.__tolariaFrontendReady = true

    rootOptions().onCaughtError?.(error, { componentStack })
    expect(mocks.sentryHandler).not.toHaveBeenCalled()
    expect(document.getElementById('tolaria-fatal-render-error')).toBeNull()

    rootOptions().onUncaughtError?.(error, { componentStack })
    expect(mocks.sentryHandler).toHaveBeenCalledWith(error, { componentStack })
  })

  it('suppresses caught BlockNote block-type mismatch render errors without component stacks', async () => {
    await importEntrypoint()

    const error = new Error('Block type does not match')
    window.__tolariaFrontendReady = true

    rootOptions().onCaughtError?.(error, {})
    expect(mocks.sentryHandler).not.toHaveBeenCalled()
    expect(document.getElementById('tolaria-fatal-render-error')).toBeNull()

    rootOptions().onUncaughtError?.(error, {})
    expect(mocks.sentryHandler).toHaveBeenCalledWith(error, { componentStack: '' })
  })

  it('suppresses caught WebKit DOM NotFoundError render recoveries from Sentry', async () => {
    await importEntrypoint()

    const error = new Error('The object can not be found here.')
    error.name = 'NotFoundError'
    window.__tolariaFrontendReady = true

    rootOptions().onCaughtError?.(error, {
      componentStack: '\n    in BlockNoteView\n    in BlockNoteRenderRecoveryBoundary',
    })

    expect(mocks.sentryHandler).not.toHaveBeenCalled()
    expect(document.getElementById('tolaria-fatal-render-error')).toBeNull()
  })

  it('suppresses recovered action tooltip render errors from Sentry', async () => {
    await importEntrypoint()

    const { markRecoveredActionTooltipError } = await import('./components/ui/actionTooltipRecovery')
    const error = new Error('tooltip content render failed')
    const componentStack = '\n    in TooltipContent\n    in ActionTooltipBoundary'
    window.__tolariaFrontendReady = true
    markRecoveredActionTooltipError(error)

    rootOptions().onCaughtError?.(error, { componentStack })

    expect(mocks.sentryHandler).not.toHaveBeenCalled()
    expect(document.getElementById('tolaria-fatal-render-error')).toBeNull()
  })

  it('mounts a frontend readiness marker after the app shell', async () => {
    await importEntrypoint()

    expect(hasElementTypeName(renderedTree(), 'FrontendReadyMarker')).toBe(true)
  })

  it('defers app-shell module loading until React resolves the root app route', async () => {
    await importEntrypoint()

    expect(mocks.loadAppModule).not.toHaveBeenCalled()
    expect(mocks.renderApp).not.toHaveBeenCalled()
  })

  it('prevents browser navigation for file drags and still lets app drop handlers run', async () => {
    await importEntrypoint()

    const appDropHandler = vi.fn()
    document.body.addEventListener('drop', appDropHandler, { once: true })

    const dragOverEvent = dispatchFileDragEvent(document.body, 'dragover')
    const dropEvent = dispatchFileDragEvent(document.body, 'drop')

    expect(dragOverEvent.defaultPrevented).toBe(true)
    expect(dropEvent.defaultPrevented).toBe(true)
    expect(appDropHandler).toHaveBeenCalledWith(dropEvent)
  })

  it('prevents browser navigation for editor file drags and still lets editor drop handlers run', async () => {
    await importEntrypoint()

    const editor = document.createElement('div')
    editor.className = 'editor__blocknote-container'
    const editorChild = document.createElement('div')
    editor.appendChild(editorChild)
    document.body.appendChild(editor)
    const editorDropHandler = vi.fn()
    editor.addEventListener('drop', editorDropHandler, { once: true })

    const dragOverEvent = dispatchFileDragEvent(editorChild, 'dragover')
    const dropEvent = dispatchFileDragEvent(editorChild, 'drop')

    expect(dragOverEvent.defaultPrevented).toBe(true)
    expect(dropEvent.defaultPrevented).toBe(true)
    expect(editorDropHandler).toHaveBeenCalledWith(dropEvent)
  })

  it('does not prevent app-internal drags without file payloads', async () => {
    await importEntrypoint()

    const dragOverEvent = createDragEventWithDataTransfer('dragover', {
      files: { length: 0 } as FileList,
      items: { length: 0 } as DataTransferItemList,
      types: ['text/plain'],
    })

    document.body.dispatchEvent(dragOverEvent)

    expect(dragOverEvent.defaultPrevented).toBe(false)
  })
})
