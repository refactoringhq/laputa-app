import { useState, useRef, useEffect, useCallback } from 'react'
import type { VaultEntry } from '../types'
import { NoteSearchList } from './NoteSearchList'
import { useNoteSearch } from '../hooks/useNoteSearch'
import { translate, type AppLocale } from '../lib/i18n'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Plus } from '@phosphor-icons/react'
import type { NoteSearchResult } from '../hooks/useNoteSearch'

interface QuickOpenPaletteProps {
  open: boolean
  entries: VaultEntry[]
  isLoading?: boolean
  onSelect: (entry: VaultEntry) => void
  onCreateNote?: (title: string) => unknown | Promise<unknown>
  onClose: () => void
  locale?: AppLocale
}

interface QuickOpenCreateActionProps {
  title: string
  onCreate: () => void | Promise<void>
  disabled: boolean
  locale: AppLocale
}

function quickOpenEmptyMessage(isLoading: boolean, locale: AppLocale): string {
  return isLoading ? translate(locale, 'status.vault.reloading') : translate(locale, 'noteList.empty.noMatching')
}

function selectAndClose(entry: VaultEntry, onSelect: (entry: VaultEntry) => void, onClose: () => void) {
  onSelect(entry)
  onClose()
}

function QuickOpenCreateAction({ title, onCreate, disabled, locale }: QuickOpenCreateActionProps) {
  return (
    <div className="border-t border-border p-2">
      <Button
        type="button"
        variant="ghost"
        className="h-9 w-full justify-start gap-2 px-2 text-sm"
        disabled={disabled}
        onClick={() => { void onCreate() }}
      >
        <Plus size={14} className="shrink-0" />
        <span className="truncate">{translate(locale, 'noteList.quickOpenCreate', { title })}</span>
      </Button>
    </div>
  )
}

function useQuickOpenCreateAction({
  query,
  isLoading,
  resultCount,
  onCreateNote,
  onClose,
}: {
  query: string
  isLoading: boolean
  resultCount: number
  onCreateNote?: (title: string) => unknown
  onClose: () => void
}) {
  const [isCreating, setIsCreating] = useState(false)
  const title = query.trim()
  const canCreate = Boolean(onCreateNote && title && !isLoading && resultCount === 0)
  const create = useCallback(async () => {
    if (!canCreate || isCreating) return
    setIsCreating(true)
    try {
      const result = await onCreateNote?.(title)
      if (result !== false) onClose()
    } finally {
      setIsCreating(false)
    }
  }, [canCreate, isCreating, title, onCreateNote, onClose])

  return { canCreate, create, title, isCreating }
}

function useQuickOpenKeyboard({
  results,
  selectedIndex,
  onSelect,
  onClose,
  handleKeyDown,
  createFromQuery,
}: {
  results: NoteSearchResult[]
  selectedIndex: number
  onSelect: (entry: VaultEntry) => void
  onClose: () => void
  handleKeyDown: (e: KeyboardEvent) => void
  createFromQuery: () => void | Promise<void>
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      handleKeyDown(e)
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const selected = results.at(selectedIndex)
        if (selected) {
          selectAndClose(selected.entry, onSelect, onClose)
        } else {
          void createFromQuery()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [results, selectedIndex, onSelect, onClose, handleKeyDown, createFromQuery])
}

function closeOnBackdrop(root: HTMLDivElement, onClose: () => void): () => void {
  const handleRootClick = (event: MouseEvent) => {
    if (event.target === root) onClose()
  }
  root.addEventListener('click', handleRootClick)
  return () => root.removeEventListener('click', handleRootClick)
}

export function QuickOpenPalette(props: QuickOpenPaletteProps) {
  if (!props.open) return null

  return <QuickOpenPaletteContent {...props} />
}

function QuickOpenPaletteContent({ entries, isLoading = false, onSelect, onCreateNote, onClose, locale = 'en' }: QuickOpenPaletteProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const { results, selectedIndex, setSelectedIndex, handleKeyDown } = useNoteSearch(entries, query)
  const createAction = useQuickOpenCreateAction({ query, isLoading, resultCount: results.length, onCreateNote, onClose })

  useEffect(() => {
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(focusTimer)
  }, [])

  useQuickOpenKeyboard({ results, selectedIndex, onSelect, onClose, handleKeyDown, createFromQuery: createAction.create })

  useEffect(() => {
    const root = rootRef.current
    return root ? closeOnBackdrop(root, onClose) : undefined
  }, [onClose])

  return (
    <div
      ref={rootRef}
      data-testid="quick-open-palette"
      className="fixed inset-0 z-[1000] flex justify-center bg-[var(--shadow-dialog)] pt-[15vh]"
    >
      <button type="button"
        aria-label="Close quick open"
        className="absolute inset-0 z-0 cursor-default border-0 bg-transparent p-0"
        onClick={onClose}
      />
      <div
        className="relative z-10 flex w-[500px] max-w-[90vw] max-h-[400px] flex-col self-start overflow-hidden rounded-xl border border-[var(--border-dialog)] bg-popover shadow-[0_8px_32px_var(--shadow-dialog)]"
      >
        <Input
          ref={inputRef}
          className="h-auto rounded-none border-0 border-b border-border px-4 py-3 text-[15px] shadow-none focus-visible:ring-0"
          type="text"
          placeholder={translate(locale, 'noteList.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <NoteSearchList
          items={results}
          selectedIndex={selectedIndex}
          getItemKey={(item) => item.entry.path}
          onItemClick={(item) => selectAndClose(item.entry, onSelect, onClose)}
          onItemHover={(i) => setSelectedIndex(i)}
          emptyMessage={quickOpenEmptyMessage(isLoading, locale)}
          className="flex-1 overflow-y-auto"
        />
        {createAction.canCreate && (
          <QuickOpenCreateAction
            title={createAction.title}
            onCreate={createAction.create}
            disabled={createAction.isCreating}
            locale={locale}
          />
        )}
      </div>
    </div>
  )
}
