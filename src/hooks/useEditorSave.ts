import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import type { SetStateAction } from 'react'
import { useSaveNote } from './useSaveNote'
import { createTranslator, type AppLocale } from '../lib/i18n'
import { canWritePathToVault } from '../utils/vaultPathContainment'

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
  /** Called immediately before content is persisted to disk. */
  onBeforePersist?: (path: string) => void
  /** Called after content is persisted — used to clear unsaved state and live-reload themes. */
  onNotePersisted?: (path: string, content: string) => void
  /** Resolve stale paths (for example after a note rename) before persisting buffered content. */
  resolvePath?: (path: string) => string
  /** Wait for an in-flight path change to settle before persisting buffered content. */
  resolvePathBeforeSave?: (path: string) => Promise<string>
  /** False when editor state is present but no vault is available to receive writes. */
  canPersist?: boolean
  /** Clears pending debounced content when the persistence target changes. */
  persistenceScope?: string | readonly string[]
  disabledSaveMessage?: string
  locale?: AppLocale
}

/**
 * Hook that manages editor content persistence with auto-save.
 * Content is auto-saved after a short idle window. Cmd+S flushes immediately.
 */
const noop = () => {}

export const AUTO_SAVE_DEBOUNCE_MS = 1_500
export const MISSING_ACTIVE_VAULT_SAVE_MESSAGE = 'Select or restore a vault before saving.'
type Translator = ReturnType<typeof createTranslator>

interface PendingContent {
  path: string
  content: string
}

interface EditorSaveCommandsParams {
  pendingContentRef: MutableRefObject<PendingContent | null>
  autoSaveTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
  setTabs: EditorSaveConfig['setTabs']
  setToastMessage: EditorSaveConfig['setToastMessage']
  saveNote: (path: string, content: string) => Promise<void>
  onAfterSave: () => void
  onAfterSaveRef: MutableRefObject<() => void>
  onBeforePersist?: EditorSaveConfig['onBeforePersist']
  onNotePersisted?: EditorSaveConfig['onNotePersisted']
  resolvePath?: EditorSaveConfig['resolvePath']
  resolvePathBeforeSave?: EditorSaveConfig['resolvePathBeforeSave']
  canPersistRef: MutableRefObject<boolean>
  persistenceScopeRef: MutableRefObject<string | readonly string[] | undefined>
  persistenceScope?: EditorSaveConfig['persistenceScope']
  disabledSaveMessage: string
  t: Translator
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

function formatSaveFailureMessage(error: unknown, t: Translator): string {
  const message = errorMessage(error)
  if (isInvalidPathSaveError(message)) return t('save.error.invalidPath')
  return t('save.error.failed', { error: message })
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

function matchesPendingContent(
  pending: PendingContent | null,
  path: string,
  content: string,
  resolvePath?: EditorSaveConfig['resolvePath'],
): pending is PendingContent {
  return matchesPendingPath(pending, path, resolvePath) && pending.content === content
}

async function persistResolvedContent({
  path,
  content,
  saveNote,
  onBeforePersist,
  resolvePath,
  resolvePathBeforeSave,
  persistenceScopeRef,
}: {
  path: string
  content: string
  saveNote: (path: string, content: string) => Promise<void>
  onBeforePersist?: EditorSaveConfig['onBeforePersist']
  resolvePath?: EditorSaveConfig['resolvePath']
  resolvePathBeforeSave?: EditorSaveConfig['resolvePathBeforeSave']
  persistenceScopeRef: MutableRefObject<string | readonly string[] | undefined>
}): Promise<string | null> {
  const targetPath = await resolvePersistPath(path, resolvePath, resolvePathBeforeSave)
  if (!canWritePathToVault(targetPath, persistenceScopeRef.current ?? '')) return null
  onBeforePersist?.(targetPath)
  await saveNote(targetPath, content)
  return targetPath
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
  t,
}: {
  autoSaveTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
  flushPending: () => Promise<boolean>
  onAfterSaveRef: MutableRefObject<() => void>
  setToastMessage: EditorSaveConfig['setToastMessage']
  t: Translator
}): void {
  autoSaveTimerRef.current = setTimeout(async () => {
    autoSaveTimerRef.current = null
    try {
      const saved = await flushPending()
      if (saved) onAfterSaveRef.current()
    } catch (err) {
      console.error('Auto-save failed:', err)
      setToastMessage(formatSaveFailureMessage(err, t))
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
  onBeforePersist,
  onNotePersisted,
  resolvePath,
  resolvePathBeforeSave,
  canPersistRef,
  persistenceScopeRef,
}: {
  pendingContentRef: MutableRefObject<PendingContent | null>
  saveNote: (path: string, content: string) => Promise<void>
  onBeforePersist?: EditorSaveConfig['onBeforePersist']
  onNotePersisted?: EditorSaveConfig['onNotePersisted']
  resolvePath?: EditorSaveConfig['resolvePath']
  resolvePathBeforeSave?: EditorSaveConfig['resolvePathBeforeSave']
  canPersistRef: MutableRefObject<boolean>
  persistenceScopeRef: MutableRefObject<string | readonly string[] | undefined>
}) {
  return useCallback(async (pathFilter?: string): Promise<boolean> => {
    const pending = pendingContentRef.current
    if (!matchesPendingPath(pending, pathFilter, resolvePath)) return false
    if (!canPersistRef.current) return false
    const { path, content } = pending
    const targetPath = await persistResolvedContent({
      path,
      content,
      saveNote,
      onBeforePersist,
      resolvePath,
      resolvePathBeforeSave,
      persistenceScopeRef,
    })
    if (targetPath === null) {
      if (pendingContentRef.current === pending) pendingContentRef.current = null
      return false
    }
    if (!matchesPendingContent(pendingContentRef.current, targetPath, content, resolvePath)) {
      return false
    }
    pendingContentRef.current = null
    onNotePersisted?.(targetPath, content)
    return true
  }, [canPersistRef, onBeforePersist, onNotePersisted, pendingContentRef, persistenceScopeRef, resolvePath, resolvePathBeforeSave, saveNote])
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

function usePendingContentScopeReset({
  cancelAutoSave,
  pendingContentRef,
  persistenceScope,
}: {
  cancelAutoSave: () => void
  pendingContentRef: MutableRefObject<PendingContent | null>
  persistenceScope?: string | readonly string[]
}) {
  const previousScopeRef = useRef(persistenceScope)

  useLayoutEffect(() => {
    if (previousScopeRef.current === persistenceScope) return
    previousScopeRef.current = persistenceScope
    pendingContentRef.current = null
    cancelAutoSave()
  }, [cancelAutoSave, pendingContentRef, persistenceScope])
}

async function persistUnsavedFallback({
  unsavedFallback,
  saveNote,
  onBeforePersist,
  onNotePersisted,
  resolvePath,
  resolvePathBeforeSave,
  persistenceScopeRef,
}: {
  unsavedFallback?: { path: string; content: string }
  saveNote: (path: string, content: string) => Promise<void>
  onBeforePersist?: EditorSaveConfig['onBeforePersist']
  onNotePersisted?: EditorSaveConfig['onNotePersisted']
  resolvePath?: EditorSaveConfig['resolvePath']
  resolvePathBeforeSave?: EditorSaveConfig['resolvePathBeforeSave']
  persistenceScopeRef: MutableRefObject<string | readonly string[] | undefined>
}): Promise<boolean> {
  if (!unsavedFallback) return false
  const targetPath = await persistResolvedContent({
    path: unsavedFallback.path,
    content: unsavedFallback.content,
    saveNote,
    onBeforePersist,
    resolvePath,
    resolvePathBeforeSave,
    persistenceScopeRef,
  })
  if (targetPath === null) return false
  onNotePersisted?.(targetPath, unsavedFallback.content)
  return true
}

function pausedSaveResult({
  canPersistRef,
  pendingContentRef,
  unsavedFallback,
  setToastMessage,
  disabledSaveMessage,
  t,
}: {
  canPersistRef: MutableRefObject<boolean>
  pendingContentRef: MutableRefObject<PendingContent | null>
  unsavedFallback?: { path: string; content: string }
  setToastMessage: EditorSaveConfig['setToastMessage']
  disabledSaveMessage: string
  t: Translator
}): boolean | null {
  if (canPersistRef.current) return null
  const hasUnsavedContent = pendingContentRef.current !== null || unsavedFallback !== undefined
  setToastMessage(hasUnsavedContent ? disabledSaveMessage : t('save.toast.nothingToSave'))
  return !hasUnsavedContent
}

async function persistImmediateSave({
  unsavedFallback,
  flushPending,
  saveNote,
  onBeforePersist,
  onNotePersisted,
  resolvePath,
  resolvePathBeforeSave,
  persistenceScopeRef,
  setToastMessage,
  onAfterSave,
  t,
}: {
  unsavedFallback?: { path: string; content: string }
  flushPending: (pathFilter?: string) => Promise<boolean>
  saveNote: (path: string, content: string) => Promise<void>
  onBeforePersist?: EditorSaveConfig['onBeforePersist']
  onNotePersisted?: EditorSaveConfig['onNotePersisted']
  resolvePath?: EditorSaveConfig['resolvePath']
  resolvePathBeforeSave?: EditorSaveConfig['resolvePathBeforeSave']
  persistenceScopeRef: MutableRefObject<string | readonly string[] | undefined>
  setToastMessage: EditorSaveConfig['setToastMessage']
  onAfterSave: () => void
  t: Translator
}): Promise<boolean> {
  try {
    const saved = await flushPending()
    const savedFallback = !saved && await persistUnsavedFallback({
      unsavedFallback,
      saveNote,
      onBeforePersist,
      onNotePersisted,
      resolvePath,
      resolvePathBeforeSave,
      persistenceScopeRef,
    })
    setToastMessage(saved || savedFallback ? t('save.toast.saved') : t('save.toast.nothingToSave'))
    onAfterSave()
    return true
  } catch (err) {
    console.error('Save failed:', err)
    setToastMessage(formatSaveFailureMessage(err, t))
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
  onBeforePersist,
  onNotePersisted,
  resolvePath,
  resolvePathBeforeSave,
  persistenceScopeRef,
  canPersistRef,
  disabledSaveMessage,
  t,
}: {
  pendingContentRef: MutableRefObject<PendingContent | null>
  cancelAutoSave: () => void
  flushPending: (pathFilter?: string) => Promise<boolean>
  setToastMessage: EditorSaveConfig['setToastMessage']
  onAfterSave: () => void
  saveNote: (path: string, content: string) => Promise<void>
  onBeforePersist?: EditorSaveConfig['onBeforePersist']
  onNotePersisted?: EditorSaveConfig['onNotePersisted']
  resolvePath?: EditorSaveConfig['resolvePath']
  resolvePathBeforeSave?: EditorSaveConfig['resolvePathBeforeSave']
  persistenceScopeRef: MutableRefObject<string | readonly string[] | undefined>
  canPersistRef: MutableRefObject<boolean>
  disabledSaveMessage: string
  t: Translator
}) {
  const handleSave = useCallback(async (unsavedFallback?: { path: string; content: string }): Promise<boolean> => {
    cancelAutoSave()
    const pausedResult = pausedSaveResult({
      canPersistRef,
      pendingContentRef,
      unsavedFallback,
      setToastMessage,
      disabledSaveMessage,
      t,
    })
    if (pausedResult !== null) return pausedResult
    return persistImmediateSave({
      unsavedFallback,
      flushPending,
      saveNote,
      onBeforePersist,
      onNotePersisted,
      resolvePath,
      resolvePathBeforeSave,
      persistenceScopeRef,
      setToastMessage,
      onAfterSave,
      t,
    })
  }, [canPersistRef, cancelAutoSave, disabledSaveMessage, flushPending, onAfterSave, onBeforePersist, onNotePersisted, pendingContentRef, persistenceScopeRef, resolvePath, resolvePathBeforeSave, saveNote, setToastMessage, t])

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
  persistenceScopeRef,
  resolvePath,
  t,
}: {
  pendingContentRef: MutableRefObject<PendingContent | null>
  autoSaveTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
  setTabs: EditorSaveConfig['setTabs']
  setToastMessage: EditorSaveConfig['setToastMessage']
  cancelAutoSave: () => void
  flushPending: () => Promise<boolean>
  onAfterSaveRef: MutableRefObject<() => void>
  canPersistRef: MutableRefObject<boolean>
  persistenceScopeRef: MutableRefObject<string | readonly string[] | undefined>
  resolvePath?: EditorSaveConfig['resolvePath']
  t: Translator
}) {
  return useCallback((path: string, content: string) => {
    const currentPath = resolveBufferedPath(path, resolvePath)
    if (!canWritePathToVault(currentPath, persistenceScopeRef.current ?? '')) return
    pendingContentRef.current = { path: currentPath, content }
    applyTabContent(setTabs, currentPath, content)
    cancelAutoSave()
    if (!canPersistRef.current) return
    scheduleAutoSave({ autoSaveTimerRef, flushPending, onAfterSaveRef, setToastMessage, t })
  }, [autoSaveTimerRef, canPersistRef, cancelAutoSave, flushPending, onAfterSaveRef, pendingContentRef, persistenceScopeRef, resolvePath, setTabs, setToastMessage, t])
}

function useEditorSaveCommands({
  pendingContentRef,
  autoSaveTimerRef,
  setTabs,
  setToastMessage,
  saveNote,
  onAfterSave,
  onAfterSaveRef,
  onBeforePersist,
  onNotePersisted,
  resolvePath,
  resolvePathBeforeSave,
  canPersistRef,
  persistenceScopeRef,
  persistenceScope,
  disabledSaveMessage,
  t,
}: EditorSaveCommandsParams) {
  const flushPending = usePendingContentFlush({
    pendingContentRef,
    saveNote,
    onBeforePersist,
    onNotePersisted,
    resolvePath,
    resolvePathBeforeSave,
    canPersistRef,
    persistenceScopeRef,
  })
  const cancelAutoSave = useCancelAutoSave(autoSaveTimerRef)
  usePendingContentScopeReset({ cancelAutoSave, pendingContentRef, persistenceScope })
  const { handleSave, savePendingForPath, savePending } = useImmediateSaveCommands({
    pendingContentRef,
    cancelAutoSave,
    flushPending,
    setToastMessage,
    onAfterSave,
    saveNote,
    onBeforePersist,
    onNotePersisted,
    resolvePath,
    resolvePathBeforeSave,
    persistenceScopeRef,
    canPersistRef,
    disabledSaveMessage,
    t,
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
    persistenceScopeRef,
    resolvePath,
    t,
  })

  return { handleSave, handleContentChange, savePendingForPath, savePending }
}

export function useEditorSave({
  updateVaultContent,
  setTabs,
  setToastMessage,
  onAfterSave = noop,
  onBeforePersist,
  onNotePersisted,
  resolvePath,
  resolvePathBeforeSave,
  canPersist = true,
  persistenceScope,
  disabledSaveMessage,
  locale = 'en',
}: EditorSaveConfig) {
  const pendingContentRef = useRef<{ path: string; content: string } | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canPersistRef = useLatestValueRef(canPersist)
  const persistenceScopeRef = useLatestValueRef(persistenceScope)
  const t = useMemo(() => createTranslator(locale), [locale])
  const disabledSaveText = disabledSaveMessage ?? t('save.toast.missingActiveVault')

  const updateTabAndContent = useCallback((path: string, content: string) => {
    if (
      pendingContentRef.current
      && !matchesPendingContent(pendingContentRef.current, path, content, resolvePath)
    ) {
      return
    }
    updateVaultContent(path, content)
    applyTabContent(setTabs, path, content)
  }, [pendingContentRef, resolvePath, updateVaultContent, setTabs])

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
    onBeforePersist,
    onNotePersisted,
    resolvePath,
    resolvePathBeforeSave,
    canPersistRef,
    persistenceScopeRef,
    persistenceScope,
    disabledSaveMessage: disabledSaveText,
    t,
  })
}
