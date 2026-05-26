import {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
  type ChangeEvent,
  type ComponentType,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
  type SVGAttributes,
} from 'react'
import { Input } from '@/components/ui/input'
import type { VaultEntry, WorkspaceIdentity } from '../types'
import { getTypeColor, getTypeLightColor } from '../utils/typeColors'
import { scrollSelectedHTMLChildIntoView } from '../utils/domScroll'
import { getTypeIcon } from './NoteItem'
import { NoteTitleIcon } from './NoteTitleIcon'
import { WorkspaceInitialsBadge } from './WorkspaceInitialsBadge'
import './WikilinkSuggestionMenu.css'

const MIN_QUERY_LENGTH = 2
const MAX_RESULTS = 10

type AutocompleteKeyAction = 'next' | 'previous' | 'select' | 'close'

interface NoteAutocompleteProps {
  entries: VaultEntry[]
  typeEntryMap: Record<string, VaultEntry>
  value: string
  onChange: (value: string) => void
  onSelect: (noteTitle: string) => void
  onEscape?: () => void
  placeholder?: string
  autoFocus?: boolean
  testId?: string
}

interface MatchedEntry {
  title: string
  noteIcon: string | null
  noteType?: string
  typeColor?: string
  typeLightColor?: string
  TypeIcon?: ComponentType<SVGAttributes<SVGSVGElement>>
  workspace?: WorkspaceIdentity | null
}

interface OpenAutocompleteKeyContext {
  action: AutocompleteKeyAction
  matches: MatchedEntry[]
  onEscape: (() => void) | undefined
  onSelect: (noteTitle: string) => void
  selectedIndex: number
  setOpen: Dispatch<SetStateAction<boolean>>
  setSelectedIndex: Dispatch<SetStateAction<number>>
  value: string
}

function entryMatchesQuery(entry: VaultEntry, lowerQuery: string): boolean {
  return entry.title.toLowerCase().includes(lowerQuery)
    || entry.aliases.some(alias => alias.toLowerCase().includes(lowerQuery))
}

function shouldShowWorkspaceBadge(entries: VaultEntry[]): boolean {
  return new Set(entries.map((entry) => entry.workspace?.alias).filter(Boolean)).size > 1
}

function buildMatchedEntry(entry: VaultEntry, typeEntryMap: Record<string, VaultEntry>, showWorkspace: boolean): MatchedEntry {
  const isA = entry.isA
  const typeEntry = Reflect.get(typeEntryMap, isA ?? '') as VaultEntry | undefined
  const noteType = isA || undefined
  return {
    title: entry.title,
    noteIcon: entry.icon,
    noteType,
    typeColor: noteType ? getTypeColor(isA, typeEntry?.color) : undefined,
    typeLightColor: noteType ? getTypeLightColor(isA, typeEntry?.color) : undefined,
    TypeIcon: noteType ? getTypeIcon(isA, typeEntry?.icon) : undefined,
    workspace: showWorkspace ? entry.workspace ?? null : null,
  }
}

function matchEntries(entries: VaultEntry[], typeEntryMap: Record<string, VaultEntry>, query: string): MatchedEntry[] {
  if (query.length < MIN_QUERY_LENGTH) return []
  const lowerQuery = query.toLowerCase()
  const showWorkspace = shouldShowWorkspaceBadge(entries)
  return entries
    .filter(entry => entryMatchesQuery(entry, lowerQuery))
    .slice(0, MAX_RESULTS)
    .map(entry => buildMatchedEntry(entry, typeEntryMap, showWorkspace))
}

function resolveOpenAutocompleteKeyAction(key: string): AutocompleteKeyAction | null {
  switch (key) {
    case 'ArrowDown':
      return 'next'
    case 'ArrowUp':
      return 'previous'
    case 'Enter':
      return 'select'
    case 'Escape':
      return 'close'
    default:
      return null
  }
}

function nextAutocompleteSelectionIndex(currentIndex: number, matchCount: number): number {
  return (currentIndex + 1) % matchCount
}

function previousAutocompleteSelectionIndex(currentIndex: number, matchCount: number): number {
  return currentIndex <= 0 ? matchCount - 1 : currentIndex - 1
}

function handleClosedAutocompleteKey(
  key: string,
  value: string,
  onSelect: (noteTitle: string) => void,
  onEscape: (() => void) | undefined,
): void {
  if (key === 'Enter') {
    onSelect(value)
    return
  }
  if (key === 'Escape') onEscape?.()
}

function preventAutocompleteMouseDown(event: React.MouseEvent): void {
  event.preventDefault()
}

function handleOpenAutocompleteKey({
  action,
  matches,
  onEscape,
  onSelect,
  selectedIndex,
  setOpen,
  setSelectedIndex,
  value,
}: OpenAutocompleteKeyContext): void {
  if (action === 'next') {
    setSelectedIndex(i => nextAutocompleteSelectionIndex(i, matches.length))
    return
  }
  if (action === 'previous') {
    setSelectedIndex(i => previousAutocompleteSelectionIndex(i, matches.length))
    return
  }
  if (action === 'close') {
    setOpen(false)
    onEscape?.()
    return
  }

  const match = matches.at(selectedIndex)
  onSelect(match?.title ?? value)
}

function handleAutocompleteKeyDown({
  event,
  matches,
  onEscape,
  onSelect,
  open,
  selectedIndex,
  setOpen,
  setSelectedIndex,
  value,
}: {
  event: KeyboardEvent<HTMLInputElement>
  matches: MatchedEntry[]
  onEscape: (() => void) | undefined
  onSelect: (noteTitle: string) => void
  open: boolean
  selectedIndex: number
  setOpen: Dispatch<SetStateAction<boolean>>
  setSelectedIndex: Dispatch<SetStateAction<number>>
  value: string
}): void {
  if (!open || matches.length === 0) {
    handleClosedAutocompleteKey(event.key, value, onSelect, onEscape)
    return
  }

  const action = resolveOpenAutocompleteKeyAction(event.key)
  if (!action) return

  event.preventDefault()
  handleOpenAutocompleteKey({ action, matches, onEscape, onSelect, selectedIndex, setOpen, setSelectedIndex, value })
}

interface NoteAutocompleteMenuItemProps {
  item: MatchedEntry
  selected: boolean
  onSelect: (title: string) => void
  onHover: () => void
}

function NoteAutocompleteMenuItem({
  item,
  selected,
  onSelect,
  onHover,
}: NoteAutocompleteMenuItemProps) {
  return (
    <button
      type="button"
      className={`wikilink-menu__item${selected ? ' wikilink-menu__item--selected' : ''}`}
      onMouseDown={preventAutocompleteMouseDown}
      onClick={() => onSelect(item.title)}
      onMouseEnter={onHover}
    >
      <span className="wikilink-menu__title" style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
        {item.TypeIcon && <item.TypeIcon width={14} height={14} style={{ color: item.typeColor, flexShrink: 0 }} />}
        <NoteTitleIcon icon={item.noteIcon} size={14} />
        {item.title}
      </span>
      {item.noteType && (
        <span className="wikilink-menu__type" style={{ color: item.typeColor, backgroundColor: item.typeLightColor, borderRadius: 9999, padding: '1px 8px' }}>
          {item.noteType}
        </span>
      )}
      <WorkspaceInitialsBadge workspace={item.workspace} testId="note-autocomplete-workspace-badge" />
    </button>
  )
}

function NoteAutocompleteMenu({
  matches,
  menuRef,
  selectedIndex,
  onHover,
  onSelect,
}: {
  matches: MatchedEntry[]
  menuRef: React.RefObject<HTMLDivElement | null>
  selectedIndex: number
  onHover: (index: number) => void
  onSelect: (title: string) => void
}) {
  if (matches.length === 0) return null

  return (
    <div className="wikilink-menu" ref={menuRef} style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2, minWidth: 'auto' }}>
      {matches.map((item, index) => (
        <NoteAutocompleteMenuItem
          key={item.title}
          item={item}
          selected={index === selectedIndex}
          onSelect={onSelect}
          onHover={() => onHover(index)}
        />
      ))}
    </div>
  )
}

export function NoteAutocomplete({ entries, typeEntryMap, value, onChange, onSelect, onEscape, placeholder, autoFocus, testId }: NoteAutocompleteProps) {
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(
    () => open ? matchEntries(entries, typeEntryMap, value) : [],
    [entries, typeEntryMap, value, open],
  )

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex < 0 || !menuRef.current) return
    scrollSelectedHTMLChildIntoView(menuRef.current, selectedIndex)
  }, [selectedIndex])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (!inputRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = useCallback((title: string) => {
    onSelect(title)
    setOpen(false)
    setSelectedIndex(-1)
  }, [onSelect])

  const handleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value)
    setOpen(true)
    setSelectedIndex(-1)
  }, [onChange])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    handleAutocompleteKeyDown({
      event,
      matches,
      onEscape,
      onSelect: handleSelect,
      open,
      selectedIndex,
      setOpen,
      setSelectedIndex,
      value,
    })
  }, [handleSelect, matches, onEscape, open, selectedIndex, value])

  return (
    <div style={{ position: 'relative' }}>
      <Input
        ref={inputRef}
        autoFocus={autoFocus}
        className="h-7 flex-1 rounded border border-border bg-transparent px-2 py-0.5 text-xs text-foreground shadow-none focus-visible:ring-1"
        style={{ borderRadius: 4, outline: 'none', minWidth: 0, width: '100%', boxSizing: 'border-box' }}
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        data-testid={testId}
      />
      {open && matches.length > 0 && (
        <NoteAutocompleteMenu
          matches={matches}
          menuRef={menuRef}
          selectedIndex={selectedIndex}
          onHover={setSelectedIndex}
          onSelect={handleSelect}
        />
      )}
    </div>
  )
}
