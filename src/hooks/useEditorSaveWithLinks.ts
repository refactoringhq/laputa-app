import { startTransition, useCallback, useRef, type MutableRefObject } from 'react'
import { useEditorSave } from './useEditorSave'
import { extractOutgoingLinks, extractSnippet, countWords, splitFrontmatter } from '../utils/wikilinks'
import { deriveRawEditorEntryState } from './rawEditorEntryState'
import { deriveDisplayTitleState } from '../utils/noteTitle'
import { detectFrontmatterState } from '../utils/frontmatter'
import type { VaultEntry } from '../types'
import type { AppLocale } from '../lib/i18n'

const EMPTY_DERIVED_ENTRY_STATE_KEY = JSON.stringify(deriveRawEditorEntryState(''))
type UpdateEntry = (path: string, patch: Partial<VaultEntry>) => void

function shouldSyncFrontmatterState(content: string): boolean {
  const frontmatterState = detectFrontmatterState(content)
  if (frontmatterState === 'invalid') return false
  return !(frontmatterState === 'none' && content.startsWith('---\n'))
}

function frontmatterSyncKey(content: string): string | null {
  if (!shouldSyncFrontmatterState(content)) return null
  return splitFrontmatter(content)[0]
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
  updateEntry(path, { outgoingLinks: links })
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
    updateEntry(path, fmPatch)
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
  startTransition(() => {
    updateEntry(path, titlePatch)
  })
}

export function useEditorSaveWithLinks(config: {
  updateEntry: (path: string, patch: Partial<VaultEntry>) => void
  setTabs: Parameters<typeof useEditorSave>[0]['setTabs']
  setToastMessage: (msg: string | null) => void
  onAfterSave: () => void
  onNotePersisted?: (path: string, content: string) => void
  resolvePath?: (path: string) => string
  resolvePathBeforeSave?: (path: string) => Promise<string>
  canPersist?: boolean
  disabledSaveMessage?: string
  locale?: AppLocale
}) {
  const { updateEntry } = config
  const saveContent = useCallback((path: string, content: string) => {
    updateEntry(path, {
      outgoingLinks: extractOutgoingLinks(content),
      snippet: extractSnippet(content),
      wordCount: countWords(content),
      modifiedAt: Math.floor(Date.now() / 1000),
    })
  }, [updateEntry])
  const editor = useEditorSave({ ...config, updateVaultContent: saveContent })
  const { handleContentChange: rawOnChange } = editor
  const prevLinksKeyRef = useRef('')
  const prevFmSourceRef = useRef<string | null>(null)
  const prevFmKeyRef = useRef(EMPTY_DERIVED_ENTRY_STATE_KEY)
  const prevTitleKeyRef = useRef('')
  const handleContentChange = useCallback((path: string, content: string) => {
    rawOnChange(path, content)
    syncOutgoingLinks({ content, path, prevLinksKeyRef, updateEntry })
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
  }, [rawOnChange, updateEntry])
  return { ...editor, handleContentChange }
}
