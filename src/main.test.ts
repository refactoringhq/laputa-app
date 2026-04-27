import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createElement, type ReactNode } from 'react'

type ReactRootErrorInfo = { componentStack?: string }
type ReactRootOptions = {
  onCaughtError?: (error: unknown, errorInfo: ReactRootErrorInfo) => void
  onUncaughtError?: (error: unknown, errorInfo: ReactRootErrorInfo) => void
  onRecoverableError?: (error: unknown, errorInfo: ReactRootErrorInfo) => void
}

const mocks = vi.hoisted(() => {
  const render = vi.fn()
  const createRoot = vi.fn(() => ({ render }))
  const sentryHandler = vi.fn()
  const reactErrorHandler = vi.fn(() => sentryHandler)
  const getShortcutEventInit = vi.fn(() => ({ key: 'x' }))

  return {
    createRoot,
    getShortcutEventInit,
    reactErrorHandler,
    render,
    sentryHandler,
  }
})

vi.mock('react-dom/client', () => ({ createRoot: mocks.createRoot }))
vi.mock('@sentry/react', () => ({ reactErrorHandler: mocks.reactErrorHandler }))
vi.mock('./App.tsx', () => ({
  default: () => createElement('div', { 'data-testid': 'mock-app' }),
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

describe('main entrypoint', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    document.body.innerHTML = '<div id="root"></div>'
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
    rootOptions().onCaughtError?.(error, { componentStack: '\n    in App' })

    expect(mocks.sentryHandler).toHaveBeenCalledWith(error, { componentStack: '\n    in App' })
  }, 60_000)

  it('normalizes missing React component stacks before handing errors to Sentry', async () => {
    await importEntrypoint()

    const error = new Error('recoverable render error')
    rootOptions().onRecoverableError?.(error, {})

    expect(mocks.sentryHandler).toHaveBeenCalledWith(error, { componentStack: '' })
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

  it('leaves editor file drags to the editor drop handler', async () => {
    await importEntrypoint()

    const editor = document.createElement('div')
    editor.className = 'editor__blocknote-container'
    const editorChild = document.createElement('div')
    editor.appendChild(editorChild)
    document.body.appendChild(editor)

    const dragOverEvent = dispatchFileDragEvent(editorChild, 'dragover')
    const dropEvent = dispatchFileDragEvent(editorChild, 'drop')

    expect(dragOverEvent.defaultPrevented).toBe(false)
    expect(dropEvent.defaultPrevented).toBe(false)
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
