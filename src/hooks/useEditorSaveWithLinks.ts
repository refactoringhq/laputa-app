import { startTransition, useCallback, useRef } from 'react'
import { useEditorSave } from './useEditorSave'
import { extractOutgoingLinks, extractSnippet, countWords } from '../utils/wikilinks'
import { deriveRawEditorEntryState } from './rawEditorEntryState'
import { deriveDisplayTitleState } from '../utils/noteTitle'
import { detectFrontmatterState } from '../utils/frontmatter'
import type { VaultEntry } from '../types'

const EMPTY_DERIVED_ENTRY_STATE_KEY = JSON.stringify(deriveRawEditorEntryState(''))

function shouldSyncFrontmatterState(content: string): boolean {
  const frontmatterState = detectFrontmatterState(content)
  if (frontmatterState === 'invalid') return false
  return !(frontmatterState === 'none' && content.startsWith('---\n'))
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
  const prevFmKeyRef = useRef(EMPTY_DERIVED_ENTRY_STATE_KEY)
  const prevTitleKeyRef = useRef('')
  const handleContentChange = useCallback((path: string, content: string) => {
    rawOnChange(path, content)
    const links = extractOutgoingLinks(content)
    const key = links.join('\0')
    if (key !== prevLinksKeyRef.current) {
      prevLinksKeyRef.current = key
      updateEntry(path, { outgoingLinks: links })
    }
    const frontmatterPatch = shouldSyncFrontmatterState(content)
      ? deriveRawEditorEntryState(content)
      : null
    const filename = path.split('/').pop() ?? path
    const titlePatch = deriveDisplayTitleState({
      content,
      filename,
      frontmatterTitle: typeof frontmatterPatch?.title === 'string' ? frontmatterPatch.title : null,
    })
    if (frontmatterPatch) {
      const fmPatch = { ...frontmatterPatch }
      delete fmPatch.title
      const fmKey = JSON.stringify(fmPatch)
      if (fmKey !== prevFmKeyRef.current) {
        prevFmKeyRef.current = fmKey
        updateEntry(path, fmPatch)
      }
    }
    const titleKey = JSON.stringify(titlePatch)
    if (titleKey !== prevTitleKeyRef.current) {
      prevTitleKeyRef.current = titleKey
      startTransition(() => {
        updateEntry(path, titlePatch)
      })
    }
  }, [rawOnChange, updateEntry])
  return { ...editor, handleContentChange }
}
