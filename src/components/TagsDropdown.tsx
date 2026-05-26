import { useState, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { getTagStyle, setTagColor, getTagColorKey } from '../utils/tagStyles'
import {
  getNextHighlightIndex,
  getPreviousHighlightIndex,
  isCreateOptionVisible,
  useAnchoredDropdownPosition,
  useAutoFocus,
} from './propertyDropdownUtils'
import { AccentColorPicker } from './AccentColorPicker'

const PROPERTY_DROPDOWN_WIDTH = 208

export function TagPill({ tag, className }: { tag: string; className?: string }) {
  const style = getTagStyle(tag)
  return (
    <span
      className={`inline-block min-w-0 truncate${className ? ` ${className}` : ''}`}
      style={{
        backgroundColor: style.bg,
        color: style.color,
        borderRadius: 16,
        padding: '1px 6px',
        fontFamily: "'Inter', sans-serif",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0',
        maxWidth: 160,
      }}
      title={tag}
    >
      {tag}
    </span>
  )
}

function ColorPickerRow({ tag, onColorChange }: { tag: string; onColorChange: (tag: string, colorKey: string) => void }) {
  const currentKey = getTagColorKey(tag)
  return (
    <div className="flex items-center gap-1 px-3 py-1.5" data-testid={`tag-color-picker-${tag}`}>
      <AccentColorPicker
        className="gap-1"
        getOptionTestId={(key) => `tag-color-option-${key}`}
        indicator="check"
        selectedColor={currentKey}
        onSelectColor={(colorKey) => onColorChange(tag, colorKey)}
        size={16}
        stopPropagation
      />
    </div>
  )
}

function TagOption({
  tag, selected, highlighted, onToggle, onMouseEnter,
  colorEditing, onToggleColor, onColorChange,
}: {
  tag: string; selected: boolean; highlighted: boolean
  onToggle: (tag: string) => void; onMouseEnter: () => void
  colorEditing: boolean
  onToggleColor: (tag: string) => void; onColorChange: (tag: string, colorKey: string) => void
}) {
  const style = getTagStyle(tag)
  return (
    <>
      <div
        className="flex w-full items-center gap-1 px-2 py-1 transition-colors"
        style={{ borderRadius: 4, backgroundColor: highlighted ? 'var(--muted)' : 'transparent' }}
      >
        <button type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 border-none bg-transparent p-0 text-left"
          onClick={() => onToggle(tag)}
          onMouseEnter={onMouseEnter}
          data-testid={`tag-option-${tag}`}
        >
          <span className="w-3.5 text-center text-[10px]" style={{ color: style.color }}>
            {selected ? '\u2713' : ''}
          </span>
          <TagPill tag={tag} />
        </button>
        <button type="button"
          className="flex size-4 shrink-0 items-center justify-center rounded-full border-none p-0"
          style={{ backgroundColor: style.color }}
          onClick={() => onToggleColor(tag)}
          onMouseEnter={onMouseEnter}
          title="Change color"
          data-testid={`tag-color-swatch-${tag}`}
        />
      </div>
      {colorEditing && <ColorPickerRow tag={tag} onColorChange={onColorChange} />}
    </>
  )
}

const SECTION_LABEL_STYLE = {
  fontFamily: "'Inter', sans-serif",
  fontSize: 9,
  fontWeight: 500,
  letterSpacing: '0',
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-2 py-1">
      <span className="text-muted-foreground" style={SECTION_LABEL_STYLE}>{children}</span>
    </div>
  )
}

function useTagFiltering(query: string, vaultTags: string[]) {
  return useMemo(() => {
    const lowerQuery = query.toLowerCase()
    const filtered = vaultTags.filter(t => t.toLowerCase().includes(lowerQuery))
    return { filtered }
  }, [query, vaultTags])
}

interface TagSelectionOptions {
  highlightIndex: number
  filtered: string[]
  showCreateOption: boolean
  query: string
  selectedTags: Set<string>
}

function getTagValueToToggle({
  highlightIndex,
  filtered,
  showCreateOption,
  query,
  selectedTags,
}: TagSelectionOptions) {
  const trimmed = query.trim()
  if (highlightIndex >= 0 && highlightIndex < filtered.length) return filtered.at(highlightIndex)
  if (showCreateOption && highlightIndex === filtered.length && trimmed) return trimmed
  if (trimmed && !selectedTags.has(trimmed)) return trimmed
  return null
}

function useTagKeyboard(opts: {
  filtered: string[]; totalOptions: number; showCreateOption: boolean
  query: string; selectedTags: Set<string>
  onToggle: (tag: string) => void; onClose: () => void
  listRef: React.RefObject<HTMLDivElement | null>
}) {
  const { filtered, totalOptions, showCreateOption, query, selectedTags, onToggle, onClose, listRef } = opts
  const [highlightIndex, setHighlightIndex] = useState(-1)

  const scrollIntoView = useCallback((index: number) => {
    const list = listRef.current
    if (!list) return
    const items = list.querySelectorAll('[data-testid^="tag-option-"], [data-testid="tag-create-option"]')
    items.item(index)?.scrollIntoView({ block: 'nearest' })
  }, [listRef])

  const moveHighlight = useCallback((nextIndex: number) => {
    setHighlightIndex(nextIndex)
    scrollIntoView(nextIndex)
  }, [scrollIntoView])

  const submitHighlightedTag = useCallback(() => {
    const value = getTagValueToToggle({ highlightIndex, filtered, showCreateOption, query, selectedTags })
    if (value) onToggle(value)
  }, [highlightIndex, filtered, showCreateOption, query, selectedTags, onToggle])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault()
          moveHighlight(getNextHighlightIndex(highlightIndex, totalOptions))
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          moveHighlight(getPreviousHighlightIndex(highlightIndex, totalOptions))
          break
        }
        case 'Enter': {
          e.preventDefault()
          submitHighlightedTag()
          break
        }
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    },
    [highlightIndex, totalOptions, moveHighlight, submitHighlightedTag, onClose],
  )

  const resetHighlight = useCallback(() => setHighlightIndex(-1), [])

  return { highlightIndex, setHighlightIndex, handleKeyDown, resetHighlight }
}

export function TagsDropdown({
  selectedTags, vaultTags, onToggle, onClose,
}: {
  selectedTags: string[]; vaultTags: string[]
  onToggle: (tag: string) => void; onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [colorEditingTag, setColorEditingTag] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selectedSet = useMemo(() => new Set(selectedTags), [selectedTags])

  useAnchoredDropdownPosition({ anchorRef, dropdownRef, width: PROPERTY_DROPDOWN_WIDTH })
  useAutoFocus(inputRef)

  const { filtered } = useTagFiltering(query, vaultTags)

  const showCreateOption = useMemo(() => isCreateOptionVisible(query, filtered), [query, filtered])

  const totalOptions = filtered.length + (showCreateOption ? 1 : 0)

  const { highlightIndex, setHighlightIndex, handleKeyDown, resetHighlight } =
    useTagKeyboard({ filtered, totalOptions, showCreateOption, query, selectedTags: selectedSet, onToggle, onClose, listRef })

  const handleToggleColor = useCallback((tag: string) => {
    setColorEditingTag(prev => prev === tag ? null : tag)
  }, [])

  const handleColorChange = useCallback((tag: string, colorKey: string) => {
    const currentKey = getTagColorKey(tag)
    setTagColor(tag, currentKey === colorKey ? null : colorKey)
    setColorEditingTag(null)
  }, [])

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    resetHighlight()
  }, [resetHighlight])

  return (
    <span ref={anchorRef} data-testid="tags-dropdown">
      {createPortal(
        <>
          <button
            type="button"
            aria-label="Close tags menu"
            className="fixed inset-0 z-[12000] cursor-default border-0 bg-transparent p-0"
            onClick={onClose}
            data-testid="tags-dropdown-backdrop"
          />
          <div
            ref={dropdownRef}
            className="fixed z-[12001] w-52 overflow-hidden rounded-lg border border-border bg-background shadow-lg"
            data-testid="tags-dropdown-popover"
          >
            <div className="border-b border-border px-2 py-1.5">
              <input
                ref={inputRef}
                className="w-full border-none bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
                placeholder="Type a tag..."
                value={query}
                onChange={e => handleQueryChange(e.target.value)}
                onKeyDown={handleKeyDown}
                data-testid="tags-search-input"
              />
            </div>
            <div ref={listRef} className="max-h-52 overflow-y-auto py-1">
              <VaultTagSection
                tags={filtered}
                selectedTags={selectedSet}
                highlightIndex={highlightIndex}
                colorEditingTag={colorEditingTag}
                onToggle={onToggle}
                onHighlight={setHighlightIndex}
                onToggleColor={handleToggleColor}
                onColorChange={handleColorChange}
              />
              <CreateTagSection
                show={showCreateOption}
                query={query}
                showDivider={filtered.length > 0}
                highlighted={highlightIndex === filtered.length}
                onToggle={onToggle}
                onMouseEnter={() => setHighlightIndex(filtered.length)}
              />
              <EmptyTagMessage show={filtered.length === 0 && !showCreateOption} />
            </div>
          </div>
        </>,
        document.body,
      )}
    </span>
  )
}

interface VaultTagSectionProps {
  tags: string[]
  selectedTags: Set<string>
  highlightIndex: number
  colorEditingTag: string | null
  onToggle: (tag: string) => void
  onHighlight: (index: number) => void
  onToggleColor: (tag: string) => void
  onColorChange: (tag: string, colorKey: string) => void
}

function VaultTagSection({
  tags,
  selectedTags,
  highlightIndex,
  colorEditingTag,
  onToggle,
  onHighlight,
  onToggleColor,
  onColorChange,
}: VaultTagSectionProps) {
  if (tags.length === 0) return null
  return (
    <div>
      <SectionLabel>From vault</SectionLabel>
      {tags.map((tag, i) => (
        <TagOption
          key={tag}
          tag={tag}
          selected={selectedTags.has(tag)}
          highlighted={highlightIndex === i}
          onToggle={onToggle}
          onMouseEnter={() => onHighlight(i)}
          colorEditing={colorEditingTag === tag}
          onToggleColor={onToggleColor}
          onColorChange={onColorChange}
        />
      ))}
    </div>
  )
}

function CreateTagSection({ show, query, showDivider, highlighted, onToggle, onMouseEnter }: {
  show: boolean; query: string; showDivider: boolean; highlighted: boolean
  onToggle: (tag: string) => void; onMouseEnter: () => void
}) {
  if (!show) return null
  const trimmed = query.trim()
  return (
    <>
      {showDivider && <div className="my-1 h-px bg-border" />}
      <button type="button"
        className="flex w-full items-center gap-1.5 border-none bg-transparent px-2 py-1 text-left text-[11px] transition-colors"
        style={{
          borderRadius: 4,
          backgroundColor: highlighted ? 'var(--muted)' : 'transparent',
          color: 'var(--muted-foreground)',
        }}
        onClick={() => onToggle(trimmed)}
        onMouseEnter={onMouseEnter}
        data-testid="tag-create-option"
      >
        Create <TagPill tag={trimmed} />
      </button>
    </>
  )
}

function EmptyTagMessage({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <div className="px-2 py-2 text-center text-[11px] text-muted-foreground">
      No matching tags
    </div>
  )
}
