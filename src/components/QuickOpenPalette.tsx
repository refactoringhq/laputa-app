import { useState, useRef, useEffect } from 'react'
import type { VaultEntry } from '../types'
import { NoteSearchList } from './NoteSearchList'
import { useNoteSearch } from '../hooks/useNoteSearch'
import { translate, type AppLocale } from '../lib/i18n'
import { Input } from '@/components/ui/input'

interface QuickOpenPaletteProps {
  open: boolean
  entries: VaultEntry[]
  isLoading?: boolean
  onSelect: (entry: VaultEntry) => void
  onClose: () => void
  locale?: AppLocale
}

export function QuickOpenPalette({ open, entries, isLoading = false, onSelect, onClose, locale = 'en' }: QuickOpenPaletteProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { results, selectedIndex, setSelectedIndex, handleKeyDown } = useNoteSearch(entries, query)

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on dialog open
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open, setSelectedIndex])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      handleKeyDown(e)
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const selected = results[selectedIndex]
        if (selected) {
          onSelect(selected.entry)
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, results, selectedIndex, onSelect, onClose, handleKeyDown])

  if (!open) return null

  return (
    <div
      data-testid="quick-open-palette"
      className="fixed inset-0 z-[1000] flex justify-center bg-[var(--shadow-dialog)] pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="flex w-[500px] max-w-[90vw] max-h-[400px] flex-col self-start overflow-hidden rounded-xl border border-[var(--border-dialog)] bg-popover shadow-[0_8px_32px_var(--shadow-dialog)]"
        onClick={(e) => e.stopPropagation()}
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
          onItemClick={(item) => {
            onSelect(item.entry)
            onClose()
          }}
          onItemHover={(i) => setSelectedIndex(i)}
          emptyMessage={isLoading ? translate(locale, 'status.vault.reloading') : translate(locale, 'noteList.empty.noMatching')}
          className="flex-1 overflow-y-auto"
        />
      </div>
    </div>
  )
}
