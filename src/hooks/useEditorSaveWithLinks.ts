import { startTransition, useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import { useEditorSave } from './useEditorSave'
import { extractOutgoingLinks, extractSnippet, countWords, splitFrontmatter } from '../utils/wikilinks'
import { deriveRawEditorEntryState } from './rawEditorEntryState'
import { deriveDisplayTitleState } from '../utils/noteTitle'
import { detectFrontmatterState } from '../utils/frontmatter'
import type { VaultEntry } from '../types'
import type { AppLocale } from '../lib/i18n'

const EMPTY_DERIVED_ENTRY_STATE_KEY = JSON.stringify(deriveRawEditorEntryState(''))
const DEFERRED_ENTRY_METADATA_TIMEOUT_MS = 1_500
const DEFERRED_ENTRY_METADATA_FALLBACK_MS = 120

type UpdateEntry = (path: string, patch: Partial<VaultEntry>) => void
type CancelDeferredWork = () => void

interface DeferredEntryMetadataSync {
  content: string
  includeSavedMetadata: boolean
  path: string
}

function shouldSyncFrontmatterState(content: string): boolean {
  const frontmatterState = detectFrontmatterState(content)
  if (frontmatterState === 'invalid') return false
  return !(frontmatterState === 'none' && content.startsWith('---\n'))
}

function frontmatterSyncKey(content: string): string | null {
  if (!shouldSyncFrontmatterState(content)) return null
  return splitFrontmatter(content)[0]
}

function scheduleDeferredWork(callback: () => void): CancelDeferredWork {
  if (typeof window === 'undefined') {
    const timeout = setTimeout(callback, DEFERRED_ENTRY_METADATA_FALLBACK_MS)
    return () => clearTimeout(timeout)
  }

  const idleWindow = window as Window & {
    cancelIdleCallback?: (handle: number) => void
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
  }
  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(
      () => callback(),
      { timeout: DEFERRED_ENTRY_METADATA_TIMEOUT_MS },
    )
    return () => idleWindow.cancelIdleCallback?.(handle)
  }

  const timeout = window.setTimeout(callback, DEFERRED_ENTRY_METADATA_FALLBACK_MS)
  return () => window.clearTimeout(timeout)
}

function updateEntryInTransition(updateEntry: UpdateEntry, path: string, patch: Partial<VaultEntry>): void {
  startTransition(() => {
    updateEntry(path, patch)
  })
}

function syncOutgoingLinks(options: {
  content: string
  path: string
  prevLinksKeyRef: MutableRefObject<string>
  updateEntry: UpdateEntry
}): void {
  const { content, path, prevLinksKeyRef, updateEntry } = options
  const links = content.includes('[[') ? extractOutgoingLinks(content) : []
  const key = links.join('\0')
  if (key === prevLinksKeyRef.current) return

  prevLinksKeyRef.current = key
  updateEntryInTransition(updateEntry, path, { outgoingLinks: links })
}

function resolveFrontmatterPatch(options: {
  content: string
  prevFmSourceRef: MutableRefObject<string | null>
}): Partial<VaultEntry> | null {
  const { content, prevFmSourceRef } = options
  const fmSource = frontmatterSyncKey(content)
  if (fmSource === null || fmSource === prevFmSourceRef.current) return null

  prevFmSourceRef.current = fmSource
  return deriveRawEditorEntryState(content)
}

function syncFrontmatterMetadata(options: {
  content: string
  path: string
  prevFmKeyRef: MutableRefObject<string>
  prevFmSourceRef: MutableRefObject<string | null>
  updateEntry: UpdateEntry
}): string | null {
  const { content, path, prevFmKeyRef, prevFmSourceRef, updateEntry } = options
  const frontmatterPatch = resolveFrontmatterPatch({ content, prevFmSourceRef })
  if (!frontmatterPatch) return null

  const frontmatterTitle = typeof frontmatterPatch.title === 'string' ? frontmatterPatch.title : null
  const fmPatch = { ...frontmatterPatch }
  delete fmPatch.title
  const fmKey = JSON.stringify(fmPatch)
  if (fmKey !== prevFmKeyRef.current) {
    prevFmKeyRef.current = fmKey
    updateEntryInTransition(updateEntry, path, fmPatch)
  }
  return frontmatterTitle
}

function syncDisplayTitle(options: {
  content: string
  frontmatterTitle: string | null
  path: string
  prevTitleKeyRef: MutableRefObject<string>
  updateEntry: UpdateEntry
}): void {
  const { content, frontmatterTitle, path, prevTitleKeyRef, updateEntry } = options
  const filename = path.split('/').pop() ?? path
  const titlePatch = deriveDisplayTitleState({ content, filename, frontmatterTitle })
  const titleKey = JSON.stringify(titlePatch)
  if (titleKey === prevTitleKeyRef.current) return

  prevTitleKeyRef.current = titleKey
  updateEntryInTransition(updateEntry, path, titlePatch)
}

function syncSavedMetadata(options: {
  content: string
  path: string
  prevLinksKeyRef: MutableRefObject<string>
  updateEntry: UpdateEntry
}): void {
  const { content, path, prevLinksKeyRef, updateEntry } = options
  const outgoingLinks = content.includes('[[') ? extractOutgoingLinks(content) : []
  prevLinksKeyRef.current = outgoingLinks.join('\0')
  updateEntryInTransition(updateEntry, path, {
    outgoingLinks,
    snippet: extractSnippet(content),
    wordCount: countWords(content),
    modifiedAt: Math.floor(Date.now() / 1000),
  })
}

function syncDeferredEntryMetadata(options: DeferredEntryMetadataSync & {
  prevFmKeyRef: MutableRefObject<string>
  prevFmSourceRef: MutableRefObject<string | null>
  prevLinksKeyRef: MutableRefObject<string>
  prevTitleKeyRef: MutableRefObject<string>
  updateEntry: UpdateEntry
}): void {
  const {
    content,
    includeSavedMetadata,
    path,
    prevFmKeyRef,
    prevFmSourceRef,
    prevLinksKeyRef,
    prevTitleKeyRef,
    updateEntry,
  } = options
  if (includeSavedMetadata) {
    syncSavedMetadata({ content, path, prevLinksKeyRef, updateEntry })
  } else {
    syncOutgoingLinks({ content, path, prevLinksKeyRef, updateEntry })
  }
  const frontmatterTitle = syncFrontmatterMetadata({
    content,
    path,
    prevFmKeyRef,
    prevFmSourceRef,
    updateEntry,
  })
  syncDisplayTitle({
    content,
    frontmatterTitle,
    path,
    prevTitleKeyRef,
    updateEntry,
  })
}

export function useEditorSaveWithLinks(config: {
  updateEntry: (path: string, patch: Partial<VaultEntry>) => void
  setTabs: Parameters<typeof useEditorSave>[0]['setTabs']
  setToastMessage: (msg: string | null) => void
  onAfterSave: () => void
  onBeforePersist?: (path: string) => void
  onNotePersisted?: (path: string, content: string) => void
  resolvePath?: (path: string) => string
  resolvePathBeforeSave?: (path: string) => Promise<string>
  canPersist?: boolean
  persistenceScope?: string | readonly string[]
  disabledSaveMessage?: string
  locale?: AppLocale
}) {
  const { updateEntry } = config
  const pendingMetadataSyncRef = useRef<DeferredEntryMetadataSync | null>(null)
  const cancelMetadataSyncRef = useRef<CancelDeferredWork | null>(null)
  const prevLinksKeyRef = useRef('')
  const prevFmSourceRef = useRef<string | null>(null)
  const prevFmKeyRef = useRef(EMPTY_DERIVED_ENTRY_STATE_KEY)
  const prevTitleKeyRef = useRef('')

  const flushMetadataSync = useCallback(() => {
    const pending = pendingMetadataSyncRef.current
    pendingMetadataSyncRef.current = null
    cancelMetadataSyncRef.current = null
    if (!pending) return

    syncDeferredEntryMetadata({
      ...pending,
      prevFmKeyRef,
      prevFmSourceRef,
      prevLinksKeyRef,
      prevTitleKeyRef,
      updateEntry,
    })
  }, [updateEntry])

  const scheduleMetadataSync = useCallback((path: string, content: string, includeSavedMetadata: boolean) => {
    pendingMetadataSyncRef.current = { content, includeSavedMetadata, path }
    cancelMetadataSyncRef.current?.()
    cancelMetadataSyncRef.current = scheduleDeferredWork(flushMetadataSync)
  }, [flushMetadataSync])

  const saveContent = useCallback((path: string, content: string) => {
    scheduleMetadataSync(path, content, true)
  }, [scheduleMetadataSync])
  const editor = useEditorSave({ ...config, updateVaultContent: saveContent })
  const { handleContentChange: rawOnChange } = editor
  const handleContentChange = useCallback((path: string, content: string) => {
    rawOnChange(path, content)
    scheduleMetadataSync(path, content, false)
  }, [rawOnChange, scheduleMetadataSync])

  useEffect(() => () => {
    pendingMetadataSyncRef.current = null
    cancelMetadataSyncRef.current?.()
    cancelMetadataSyncRef.current = null
  }, [])

  return { ...editor, handleContentChange }
}
