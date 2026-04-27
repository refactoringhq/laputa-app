import { useEffect, useRef, useState } from 'react'
import { isTauri } from '../mock-tauri'
import {
  APP_COMMAND_EVENT_NAME,
  executeAppCommand,
  isAppCommandId,
  type AppCommandHandlers,
} from './appCommandDispatcher'
import {
  NOTE_LIST_SEARCH_AVAILABILITY_EVENT,
  dispatchNoteListSearchToggle,
  readNoteListSearchAvailability,
} from '../utils/noteListSearchEvents'
import {
  EDITOR_FIND_AVAILABILITY_EVENT,
  readEditorFindAvailability,
} from '../utils/editorFindEvents'

const NOTE_LIST_SEARCH_MENU_ID = 'edit-toggle-note-list-search'

type NativeUnlisten = () => void | Promise<void>

export interface MenuEventHandlers extends AppCommandHandlers {
  activeTabPath: string | null
  modifiedCount?: number
  conflictCount?: number
  hasRestorableDeletedNote?: boolean
  hasNoRemote?: boolean
}

interface MenuStatePayload {
  hasActiveNote: boolean
  hasModifiedFiles?: boolean
  hasConflicts?: boolean
  hasRestorableDeletedNote?: boolean
  hasNoRemote?: boolean
  noteListSearchEnabled?: boolean
  editorFindEnabled?: boolean
}

function readCustomEventDetail(event: Event): string | null {
  if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') {
    return null
  }
  return event.detail
}

function createWindowCommandListener(
  dispatch: (id: string) => void,
): (event: Event) => void {
  return (event: Event) => {
    const detail = readCustomEventDetail(event)
    if (detail) {
      dispatch(detail)
    }
  }
}

function syncNativeMenuState(state: MenuStatePayload): void {
  if (!isTauri()) return

  import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('update_menu_state', { state }))
    .catch((err) => console.warn('[menu] Failed to sync native menu state:', err))
}

function cleanupNativeMenuListener(unlisten: NativeUnlisten): void {
  void Promise.resolve()
    .then(unlisten)
    .catch(() => {})
}

function useNativeMenuEventListener(handlersRef: { current: MenuEventHandlers }) {
  useEffect(() => {
    if (!isTauri()) return

    let disposed = false
    let unlisten: NativeUnlisten | null = null

    import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        const teardown = await listen<string>('menu-event', (event) => {
          dispatchMenuEvent(event.payload, handlersRef.current)
        })

        if (disposed) {
          cleanupNativeMenuListener(teardown)
          return
        }

        unlisten = teardown
      })
      .catch(() => {
        /* not in Tauri */
      })

    return () => {
      disposed = true
      if (unlisten) cleanupNativeMenuListener(unlisten)
    }
  }, [handlersRef])
}

function useWindowAppCommandListener(handlersRef: { current: MenuEventHandlers }) {
  useEffect(() => {
    const handleCommandEvent = createWindowCommandListener((detail) => {
      if (isAppCommandId(detail)) {
        executeAppCommand(detail, handlersRef.current, 'app-event')
      }
    })

    window.addEventListener(APP_COMMAND_EVENT_NAME, handleCommandEvent)
    return () => window.removeEventListener(APP_COMMAND_EVENT_NAME, handleCommandEvent)
  }, [handlersRef])
}

function useTestMenuCommandBridge(handlersRef: { current: MenuEventHandlers }) {
  useEffect(() => {
    const bridge = (id: string) => {
      dispatchMenuEvent(id, handlersRef.current)
    }

    window.__laputaTest = {
      ...window.__laputaTest,
      dispatchBrowserMenuCommand: bridge,
    }

    return () => {
      if (window.__laputaTest?.dispatchBrowserMenuCommand === bridge) {
        delete window.__laputaTest.dispatchBrowserMenuCommand
      }
    }
  }, [handlersRef])
}

function useNativeMenuStateSync(state: MenuStatePayload) {
  useEffect(() => {
    syncNativeMenuState(state)
  }, [state])
}

function useAvailabilityMenuState(
  eventName: string,
  readAvailability: (event: Event) => boolean | null,
) {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    const handleAvailabilityEvent = (event: Event) => {
      const nextEnabled = readAvailability(event)
      if (nextEnabled !== null) setEnabled(nextEnabled)
    }

    window.addEventListener(eventName, handleAvailabilityEvent)
    return () => window.removeEventListener(eventName, handleAvailabilityEvent)
  }, [eventName, readAvailability])

  return enabled
}

/** Dispatch a Tauri menu event ID to the matching handler. Exported for testing. */
export function dispatchMenuEvent(id: string, h: MenuEventHandlers): void {
  if (id === NOTE_LIST_SEARCH_MENU_ID) {
    dispatchNoteListSearchToggle()
    return
  }
  if (!isAppCommandId(id)) return
  executeAppCommand(id, h, 'native-menu')
}

/** Listen for native macOS menu events and dispatch them to the appropriate handlers. */
export function useMenuEvents(handlers: MenuEventHandlers) {
  const ref = useRef(handlers)
  const noteListSearchEnabled = useAvailabilityMenuState(
    NOTE_LIST_SEARCH_AVAILABILITY_EVENT,
    readNoteListSearchAvailability,
  )
  const editorFindEnabled = useAvailabilityMenuState(
    EDITOR_FIND_AVAILABILITY_EVENT,
    readEditorFindAvailability,
  )
  const hasActiveNote = handlers.activeTabPath !== null
  const hasModifiedFiles = handlers.modifiedCount != null ? handlers.modifiedCount > 0 : undefined
  const hasConflicts = handlers.conflictCount != null ? handlers.conflictCount > 0 : undefined
  const hasRestorableDeletedNote = handlers.hasRestorableDeletedNote
  const hasNoRemote = handlers.hasNoRemote

  useEffect(() => {
    ref.current = handlers
  }, [handlers])

  useNativeMenuEventListener(ref)
  useWindowAppCommandListener(ref)
  useTestMenuCommandBridge(ref)
  useNativeMenuStateSync({
    hasActiveNote,
    hasModifiedFiles,
    hasConflicts,
    hasRestorableDeletedNote,
    hasNoRemote,
    noteListSearchEnabled,
    editorFindEnabled,
  })
}
