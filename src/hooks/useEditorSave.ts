import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react'
import type { SetStateAction } from 'react'
import { useSaveNote } from './useSaveNote'

interface Tab {
  entry: { path: string }
  content: string
}

interface EditorSaveConfig {
  updateVaultContent: (path: string, content: string) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tab types vary between layers
  setTabs: (fn: SetStateAction<any[]>) => void
  setToastMessage: (msg: string | null) => void
  onAfterSave?: () => void
  /** Called after content is persisted — used to clear unsaved state and live-reload themes. */
  onNotePersisted?: (path: string, content: string) => void
  /** Resolve stale paths (for example after a note rename) before persisting buffered content. */
  resolvePath?: (path: string) => string
  /** Wait for an in-flight path change to settle before persisting buffered content. */
  resolvePathBeforeSave?: (path: string) => Promise<string>
  /** False when editor state is present but no vault is available to receive writes. */
  canPersist?: boolean
  disabledSaveMessage?: string
}

/**
 * Hook that manages editor content persistence with auto-save.
 * Content is auto-saved 500ms after the last edit. Cmd+S flushes immediately.
 */
const noop = () => {}

const AUTO_SAVE_DEBOUNCE_MS = 500
const INVALID_PATH_SAVE_MESSAGE = 'Save failed: The note path is invalid on this platform. Rename the note or move it to a valid folder, then try again.'
export const MISSING_ACTIVE_VAULT_SAVE_MESSAGE = 'Select or restore a vault before saving.'

interface PendingContent {
  path: string
  content: string
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function isInvalidPathSaveError(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('os error 123')
    || normalized.includes('filename, directory name, or volume label syntax is incorrect')
    || normalized.includes('path is invalid on this platform')
}

function formatSaveFailureMessage(error: unknown): string {
  const message = errorMessage(error)
  if (isInvalidPathSaveError(message)) return INVALID_PATH_SAVE_MESSAGE
  return `Save failed: ${message}`
}

function useLatestValueRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  }, [value])
  return ref
}

function resolveBufferedPath(path: string, resolvePath?: EditorSaveConfig['resolvePath']): string {
  return resolvePath?.(path) ?? path
}

async function resolvePersistPath(
  path: string,
  resolvePath?: EditorSaveConfig['resolvePath'],
  resolvePathBeforeSave?: EditorSaveConfig['resolvePathBeforeSave'],
): Promise<string> {
  const currentPath = resolveBufferedPath(path, resolvePath)
  return resolvePathBeforeSave ? resolvePathBeforeSave(currentPath) : currentPath
}

function matchesPendingPath(
  pending: PendingContent | null,
  pathFilter?: string,
  resolvePath?: EditorSaveConfig['resolvePath'],
): pending is PendingContent {
  if (!pending) return false
  if (!pathFilter) return true
  return resolveBufferedPath(pending.path, resolvePath) === resolveBufferedPath(pathFilter, resolvePath)
}

async function persistResolvedContent({
  path,
  content,
  saveNote,
  onNotePersisted,
  resolvePath,
  resolvePathBeforeSave,
}: {
  path: string
  content: string
  saveNote: (path: string, content: string) => Promise<void>
  onNotePersisted?: EditorSaveConfig['onNotePersisted']
  resolvePath?: EditorSaveConfig['resolvePath']
  resolvePathBeforeSave?: EditorSaveConfig['resolvePathBeforeSave']
}): Promise<void> {
  const targetPath = await resolvePersistPath(path, resolvePath, resolvePathBeforeSave)
  await saveNote(targetPath, content)
  onNotePersisted?.(targetPath, content)
}

function applyTabContent(
  setTabs: EditorSaveConfig['setTabs'],
  path: string,
  content: string,
): void {
  setTabs((prev: Tab[]) =>
    prev.map((t) => t.entry.path === path ? { ...t, content } : t)
  )
}

function scheduleAutoSave({
  autoSaveTimerRef,
  flushPending,
  onAfterSaveRef,
  setToastMessage,
}: {
  autoSaveTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
  flushPending: () => Promise<boolean>
  onAfterSaveRef: MutableRefObject<() => void>
  setToastMessage: EditorSaveConfig['setToastMessage']
}): void {
  autoSaveTimerRef.current = setTimeout(async () => {
    autoSaveTimerRef.current = null
    try {
      const saved = await flushPending()
      if (saved) onAfterSaveRef.current()
    } catch (err) {
      console.error('Auto-save failed:', err)
      setToastMessage(formatSaveFailureMessage(err))
    }
  }, AUTO_SAVE_DEBOUNCE_MS)
}

function useOnAfterSaveRef(onAfterSave: () => void) {
  const onAfterSaveRef = useRef(onAfterSave)
  useEffect(() => { onAfterSaveRef.current = onAfterSave }, [onAfterSave])
  return onAfterSaveRef
}

function usePendingContentFlush({
  pendingContentRef,
  saveNote,
  onNotePersisted,
  resolvePath,
  resolvePathBeforeSave,
  canPersistRef,
}: {
  pendingContentRef: MutableRefObject<PendingContent | null>
  saveNote: (path: string, content: string) => Promise<void>
  onNotePersisted?: EditorSaveConfig['onNotePersisted']
  resolvePath?: EditorSaveConfig['resolvePath']
  resolvePathBeforeSave?: EditorSaveConfig['resolvePathBeforeSave']
  canPersistRef: MutableRefObject<boolean>
}) {
  return useCallback(async (pathFilter?: string): Promise<boolean> => {
    const pending = pendingContentRef.current
    if (!matchesPendingPath(pending, pathFilter, resolvePath)) return false
    if (!canPersistRef.current) return false
    const { path, content } = pending
    await persistResolvedContent({
      path,
      content,
      saveNote,
      onNotePersisted,
      resolvePath,
      resolvePathBeforeSave,
    })
    pendingContentRef.current = null
    return true
  }, [canPersistRef, onNotePersisted, pendingContentRef, resolvePath, resolvePathBeforeSave, saveNote])
}

function useCancelAutoSave(autoSaveTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>) {
  const cancelAutoSave = useCallback(() => {
    if (!autoSaveTimerRef.current) return
    clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = null
  }, [autoSaveTimerRef])

  useEffect(() => () => cancelAutoSave(), [cancelAutoSave])
  return cancelAutoSave
}

async function persistUnsavedFallback({
  unsavedFallback,
  saveNote,
  onNotePersisted,
  resolvePath,
  resolvePathBeforeSave,
}: {
  unsavedFallback?: { path: string; content: string }
  saveNote: (path: string, content: string) => Promise<void>
  onNotePersisted?: EditorSaveConfig['onNotePersisted']
  resolvePath?: EditorSaveConfig['resolvePath']
  resolvePathBeforeSave?: EditorSaveConfig['resolvePathBeforeSave']
}): Promise<boolean> {
  if (!unsavedFallback) return false
  await persistResolvedContent({
    path: unsavedFallback.path,
    content: unsavedFallback.content,
    saveNote,
    onNotePersisted,
    resolvePath,
    resolvePathBeforeSave,
  })
  return true
}

function pausedSaveResult({
  canPersistRef,
  pendingContentRef,
  unsavedFallback,
  setToastMessage,
  disabledSaveMessage,
}: {
  canPersistRef: MutableRefObject<boolean>
  pendingContentRef: MutableRefObject<PendingContent | null>
  unsavedFallback?: { path: string; content: string }
  setToastMessage: EditorSaveConfig['setToastMessage']
  disabledSaveMessage: string
}): boolean | null {
  if (canPersistRef.current) return null
  const hasUnsavedContent = pendingContentRef.current !== null || unsavedFallback !== undefined
  setToastMessage(hasUnsavedContent ? disabledSaveMessage : 'Nothing to save')
  return !hasUnsavedContent
}

async function persistImmediateSave({
  unsavedFallback,
  flushPending,
  saveNote,
  onNotePersisted,
  resolvePath,
  resolvePathBeforeSave,
  setToastMessage,
  onAfterSave,
}: {
  unsavedFallback?: { path: string; content: string }
  flushPending: (pathFilter?: string) => Promise<boolean>
  saveNote: (path: string, content: string) => Promise<void>
  onNotePersisted?: EditorSaveConfig['onNotePersisted']
  resolvePath?: EditorSaveConfig['resolvePath']
  resolvePathBeforeSave?: EditorSaveConfig['resolvePathBeforeSave']
  setToastMessage: EditorSaveConfig['setToastMessage']
  onAfterSave: () => void
}): Promise<boolean> {
  try {
    const saved = await flushPending()
    const savedFallback = !saved && await persistUnsavedFallback({
      unsavedFallback,
      saveNote,
      onNotePersisted,
      resolvePath,
      resolvePathBeforeSave,
    })
    setToastMessage(saved || savedFallback ? 'Saved' : 'Nothing to save')
    onAfterSave()
    return true
  } catch (err) {
    console.error('Save failed:', err)
    setToastMessage(formatSaveFailureMessage(err))
    return false
  }
}

function useImmediateSaveCommands({
  pendingContentRef,
  cancelAutoSave,
  flushPending,
  setToastMessage,
  onAfterSave,
  saveNote,
  onNotePersisted,
  resolvePath,
  resolvePathBeforeSave,
  canPersistRef,
  disabledSaveMessage,
}: {
  pendingContentRef: MutableRefObject<PendingContent | null>
  cancelAutoSave: () => void
  flushPending: (pathFilter?: string) => Promise<boolean>
  setToastMessage: EditorSaveConfig['setToastMessage']
  onAfterSave: () => void
  saveNote: (path: string, content: string) => Promise<void>
  onNotePersisted?: EditorSaveConfig['onNotePersisted']
  resolvePath?: EditorSaveConfig['resolvePath']
  resolvePathBeforeSave?: EditorSaveConfig['resolvePathBeforeSave']
  canPersistRef: MutableRefObject<boolean>
  disabledSaveMessage: string
}) {
  const handleSave = useCallback(async (unsavedFallback?: { path: string; content: string }): Promise<boolean> => {
    cancelAutoSave()
    const pausedResult = pausedSaveResult({
      canPersistRef,
      pendingContentRef,
      unsavedFallback,
      setToastMessage,
      disabledSaveMessage,
    })
    if (pausedResult !== null) return pausedResult
    return persistImmediateSave({
      unsavedFallback,
      flushPending,
      saveNote,
      onNotePersisted,
      resolvePath,
      resolvePathBeforeSave,
      setToastMessage,
      onAfterSave,
    })
  }, [canPersistRef, cancelAutoSave, disabledSaveMessage, flushPending, onAfterSave, onNotePersisted, pendingContentRef, resolvePath, resolvePathBeforeSave, saveNote, setToastMessage])

  const savePendingForPath = useCallback(
    (path: string): Promise<boolean> => {
      cancelAutoSave()
      return canPersistRef.current ? flushPending(path) : Promise.resolve(false)
    },
    [canPersistRef, cancelAutoSave, flushPending],
  )

  const savePending = useCallback((): Promise<boolean> => {
    cancelAutoSave()
    return canPersistRef.current ? flushPending() : Promise.resolve(false)
  }, [canPersistRef, cancelAutoSave, flushPending])

  return { handleSave, savePendingForPath, savePending }
}

function useContentChangeCommand({
  pendingContentRef,
  autoSaveTimerRef,
  setTabs,
  setToastMessage,
  cancelAutoSave,
  flushPending,
  onAfterSaveRef,
  canPersistRef,
}: {
  pendingContentRef: MutableRefObject<PendingContent | null>
  autoSaveTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
  setTabs: EditorSaveConfig['setTabs']
  setToastMessage: EditorSaveConfig['setToastMessage']
  cancelAutoSave: () => void
  flushPending: () => Promise<boolean>
  onAfterSaveRef: MutableRefObject<() => void>
  canPersistRef: MutableRefObject<boolean>
}) {
  return useCallback((path: string, content: string) => {
    pendingContentRef.current = { path, content }
    applyTabContent(setTabs, path, content)
    cancelAutoSave()
    if (!canPersistRef.current) return
    scheduleAutoSave({ autoSaveTimerRef, flushPending, onAfterSaveRef, setToastMessage })
  }, [autoSaveTimerRef, canPersistRef, cancelAutoSave, flushPending, onAfterSaveRef, pendingContentRef, setTabs, setToastMessage])
}

function useEditorSaveCommands({
  pendingContentRef,
  autoSaveTimerRef,
  setTabs,
  setToastMessage,
  saveNote,
  onAfterSave,
  onAfterSaveRef,
  onNotePersisted,
  resolvePath,
  resolvePathBeforeSave,
  canPersistRef,
  disabledSaveMessage,
}: {
  pendingContentRef: MutableRefObject<PendingContent | null>
  autoSaveTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
  setTabs: EditorSaveConfig['setTabs']
  setToastMessage: EditorSaveConfig['setToastMessage']
  saveNote: (path: string, content: string) => Promise<void>
  onAfterSave: () => void
  onAfterSaveRef: MutableRefObject<() => void>
  onNotePersisted?: EditorSaveConfig['onNotePersisted']
  resolvePath?: EditorSaveConfig['resolvePath']
  resolvePathBeforeSave?: EditorSaveConfig['resolvePathBeforeSave']
  canPersistRef: MutableRefObject<boolean>
  disabledSaveMessage: string
}) {
  const flushPending = usePendingContentFlush({
    pendingContentRef,
    saveNote,
    onNotePersisted,
    resolvePath,
    resolvePathBeforeSave,
    canPersistRef,
  })
  const cancelAutoSave = useCancelAutoSave(autoSaveTimerRef)
  const { handleSave, savePendingForPath, savePending } = useImmediateSaveCommands({
    pendingContentRef,
    cancelAutoSave,
    flushPending,
    setToastMessage,
    onAfterSave,
    saveNote,
    onNotePersisted,
    resolvePath,
    resolvePathBeforeSave,
    canPersistRef,
    disabledSaveMessage,
  })
  const handleContentChange = useContentChangeCommand({
    pendingContentRef,
    autoSaveTimerRef,
    setTabs,
    setToastMessage,
    cancelAutoSave,
    flushPending: () => flushPending(),
    onAfterSaveRef,
    canPersistRef,
  })

  return { handleSave, handleContentChange, savePendingForPath, savePending }
}

export function useEditorSave({
  updateVaultContent,
  setTabs,
  setToastMessage,
  onAfterSave = noop,
  onNotePersisted,
  resolvePath,
  resolvePathBeforeSave,
  canPersist = true,
  disabledSaveMessage = MISSING_ACTIVE_VAULT_SAVE_MESSAGE,
}: EditorSaveConfig) {
  const pendingContentRef = useRef<{ path: string; content: string } | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canPersistRef = useLatestValueRef(canPersist)

  const updateTabAndContent = useCallback((path: string, content: string) => {
    updateVaultContent(path, content)
    applyTabContent(setTabs, path, content)
  }, [updateVaultContent, setTabs])

  const { saveNote } = useSaveNote(updateTabAndContent)
  const onAfterSaveRef = useOnAfterSaveRef(onAfterSave)

  return useEditorSaveCommands({
    pendingContentRef,
    autoSaveTimerRef,
    setTabs,
    setToastMessage,
    saveNote,
    onAfterSave,
    onAfterSaveRef,
    onNotePersisted,
    resolvePath,
    resolvePathBeforeSave,
    canPersistRef,
    disabledSaveMessage,
  })
}
