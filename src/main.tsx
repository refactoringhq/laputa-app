import { StrictMode } from 'react'
import * as Sentry from '@sentry/react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import './index.css'
import App from './App.tsx'
import { FrontendReadyMarker } from './components/FrontendReadyMarker'
import { LinuxTitlebar } from './components/LinuxTitlebar'
import { applyStoredThemeMode } from './lib/themeMode'
import {
  APP_COMMAND_EVENT_NAME,
  isAppCommandId,
  isNativeMenuCommandId,
} from './hooks/appCommandDispatcher'
import {
  getShortcutEventInit,
  type AppCommandShortcutEventInit,
  type AppCommandShortcutEventOptions,
} from './hooks/appCommandCatalog'
import { isRecoveredBlockNoteRenderError } from './components/blockNoteRenderRecovery'
import { shouldUseLinuxWindowChrome } from './utils/platform'
import { reloadFrontendOnceIfStartupFailed } from './utils/frontendReady'

const EDITOR_DROP_SELECTOR = '.editor__blocknote-container'
const TLDRAW_CONTEXT_MENU_SELECTOR = '.tldraw-whiteboard'

function dataTransferHasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false
  if (dataTransfer.files.length > 0) return true
  if (Array.from(dataTransfer.types).includes('Files')) return true

  return Array.from(dataTransfer.items).some((item) => item.kind === 'file')
}

function isEditorDropTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITOR_DROP_SELECTOR) !== null
}

function preventFileDropNavigation(event: DragEvent): void {
  if (isEditorDropTarget(event.target)) return
  if (!dataTransferHasFiles(event.dataTransfer)) return

  event.preventDefault()
}

function isTldrawContextMenuTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TLDRAW_CONTEXT_MENU_SELECTOR) !== null
}

function preventNativeContextMenu(event: MouseEvent): void {
  if (isTldrawContextMenuTarget(event.target)) return

  event.preventDefault()
}

document.addEventListener('dragover', preventFileDropNavigation, true)
document.addEventListener('drop', preventFileDropNavigation, true)

// Disable native WebKit context menu in Tauri (WKWebView intercepts right-click
// at native level before React's synthetic events can call preventDefault).
// Capture phase fires first → prevents native menu; React bubble phase still fires
// → our custom context menus (e.g. sidebar right-click) work correctly.
if ('__TAURI__' in window || '__TAURI_INTERNALS__' in window) {
  document.addEventListener('contextmenu', preventNativeContextMenu, true)
}

if (shouldUseLinuxWindowChrome()) {
  document.body.classList.add('linux-chrome')
}

applyStoredThemeMode(document, window.localStorage)

function dispatchDeterministicShortcutEvent(init: AppCommandShortcutEventInit) {
  const target =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : document.body ?? window

  target.dispatchEvent(new KeyboardEvent('keydown', init))
}

window.__laputaTest = {
  dispatchAppCommand(id: string) {
    if (!isAppCommandId(id)) {
      throw new Error(`Unknown app command: ${id}`)
    }
    window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT_NAME, { detail: id }))
  },
  dispatchShortcutEvent(init: AppCommandShortcutEventInit) {
    dispatchDeterministicShortcutEvent(init)
  },
  async triggerMenuCommand(id: string) {
    if (!isNativeMenuCommandId(id)) {
      throw new Error(`Unknown native menu command: ${id}`)
    }

    if ('__TAURI__' in window || '__TAURI_INTERNALS__' in window) {
      const { invoke } = await import('@tauri-apps/api/core')
      return invoke('trigger_menu_command', { id })
    }

    if (!window.__laputaTest?.dispatchBrowserMenuCommand) {
      throw new Error('Tolaria test bridge is missing dispatchBrowserMenuCommand')
    }

    window.__laputaTest.dispatchBrowserMenuCommand(id)
    return undefined
  },
  triggerShortcutCommand(id: string, options?: AppCommandShortcutEventOptions) {
    if (!isAppCommandId(id)) {
      throw new Error(`Unknown app command: ${id}`)
    }

    const init = getShortcutEventInit(id, options)
    if (!init) {
      throw new Error(`Command ${id} does not define a keyboard shortcut`)
    }

    dispatchDeterministicShortcutEvent(init)
  },
}

const sentryReactErrorHandler = Sentry.reactErrorHandler()

function isResizeObserverLoopError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('ResizeObserver loop completed with undelivered notifications')
    || message.includes('ResizeObserver loop limit exceeded')
}

function showFatalRenderError(
  error: unknown,
  errorInfo: { componentStack?: string },
): void {
  const existing = document.getElementById('tolaria-fatal-render-error')
  const overlay = existing ?? document.createElement('pre')
  overlay.id = 'tolaria-fatal-render-error'
  overlay.style.cssText = [
    'position:fixed',
    'inset:24px',
    'z-index:2147483647',
    'overflow:auto',
    'margin:0',
    'padding:16px',
    'border-radius:8px',
    'background:#1f1f1f',
    'color:#fff',
    'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
    'white-space:pre-wrap',
  ].join(';')

  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  overlay.textContent = [
    'Tolaria render error',
    '',
    message,
    '',
    errorInfo.componentStack ?? '',
  ].join('\n')
  document.body.appendChild(overlay)
}

function captureReactRootError(
  error: unknown,
  errorInfo: { componentStack?: string },
): void {
  if (isResizeObserverLoopError(error)) return

  const componentStack = errorInfo.componentStack ?? ''
  showFatalRenderError(error, { componentStack })
  sentryReactErrorHandler(error, { componentStack })
  reloadFrontendOnceIfStartupFailed()
}

function captureRecoverableReactRootError(
  error: unknown,
  errorInfo: { componentStack?: string },
): void {
  const componentStack = errorInfo.componentStack ?? ''
  if (isResizeObserverLoopError(error)) return
  if (isRecoveredBlockNoteRenderError(error, componentStack)) return

  captureReactRootError(error, { componentStack })
}

createRoot(document.getElementById('root')!, {
  onCaughtError: captureRecoverableReactRootError,
  onUncaughtError: captureReactRootError,
  onRecoverableError: captureRecoverableReactRootError,
}).render(
  <StrictMode>
    <TooltipProvider>
      <LinuxTitlebar />
      <App />
      <FrontendReadyMarker />
    </TooltipProvider>
  </StrictMode>,
)
