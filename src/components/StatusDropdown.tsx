import { useState, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { getStatusStyle, SUGGESTED_STATUSES, setStatusColor, getStatusColorKey } from '../utils/statusStyles'
import { ACCENT_COLORS } from '../utils/typeColors'
import {
  getNextHighlightIndex,
  getPreviousHighlightIndex,
  isCreateOptionVisible,
  useAnchoredDropdownPosition,
  useAutoFocus,
} from './propertyDropdownUtils'

const PROPERTY_DROPDOWN_WIDTH = 208
const SELECTED_SWATCH_CHECK_STYLE = { color: 'var(--text-inverse)', fontSize: 8, lineHeight: 1 } as const

export function StatusPill({ status, className }: { status: string; className?: string }) {
  const style = getStatusStyle(status)
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
      title={status}
    >
      {status}
    </span>
  )
}

function ColorPickerRow({ status, onColorChange }: { status: string; onColorChange: (status: string, colorKey: string) => void }) {
  const currentKey = getStatusColorKey(status)
  return (
    <div className="flex items-center gap-1 px-3 py-1.5" data-testid={`color-picker-${status}`}>
      {ACCENT_COLORS.map(c => (
        <button type="button"
          key={c.key}
          className="flex size-4 shrink-0 items-center justify-center rounded-full border-none p-0 transition-transform hover:scale-125"
          style={{ backgroundColor: c.css }}
          onClick={(e) => { e.stopPropagation(); onColorChange(status, c.key) }}
          title={c.label}
          data-testid={`color-option-${c.key}`}
        >
          {currentKey === c.key && (
            <span style={SELECTED_SWATCH_CHECK_STYLE}>{'\u2713'}</span>
          )}
        </button>
      ))}
    </div>
  )
}

function StatusOption({
  status,
  highlighted,
  onSelect,
  onMouseEnter,
  colorEditing,
  onToggleColor,
  onColorChange,
}: {
  status: string
  highlighted: boolean
  onSelect: (status: string) => void
  onMouseEnter: () => void
  colorEditing: boolean
  onToggleColor: (status: string) => void
  onColorChange: (status: string, colorKey: string) => void
}) {
  const style = getStatusStyle(status)
  return (
    <>
      <div
        className="flex w-full items-center gap-1 px-2 py-1 transition-colors"
        style={{
          borderRadius: 4,
          backgroundColor: highlighted ? 'var(--muted)' : 'transparent',
        }}
      >
        <button type="button"
          className="flex min-w-0 flex-1 items-center border-none bg-transparent p-0 text-left"
          onClick={() => onSelect(status)}
          onMouseEnter={onMouseEnter}
          data-testid={`status-option-${status}`}
        >
          <StatusPill status={status} />
        </button>
        <button type="button"
          className="flex size-4 shrink-0 items-center justify-center rounded-full border-none p-0"
          style={{ backgroundColor: style.color }}
          onClick={() => onToggleColor(status)}
          onMouseEnter={onMouseEnter}
          title="Change color"
          data-testid={`status-color-swatch-${status}`}
        />
      </div>
      {colorEditing && <ColorPickerRow status={status} onColorChange={onColorChange} />}
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

interface StatusOptionProps {
  highlightOffset: number
  highlightIndex: number
  colorEditingStatus: string | null
  onSelect: (status: string) => void
  onHighlight: (index: number) => void
  onToggleColor: (status: string) => void
  onColorChange: (status: string, colorKey: string) => void
}

function StatusOptionList({ statuses, ...props }: StatusOptionProps & { statuses: string[] }) {
  return (
    <>
      {statuses.map((status, i) => (
        <StatusOption
          key={status}
          status={status}
          highlighted={props.highlightIndex === props.highlightOffset + i}
          onSelect={props.onSelect}
          onMouseEnter={() => props.onHighlight(props.highlightOffset + i)}
          colorEditing={props.colorEditingStatus === status}
          onToggleColor={props.onToggleColor}
          onColorChange={props.onColorChange}
        />
      ))}
    </>
  )
}

function useStatusFiltering(query: string, vaultStatuses: string[]) {
  return useMemo(() => {
    const lowerQuery = query.toLowerCase()
    const vaultSet = new Set(vaultStatuses.map(s => s.toLowerCase()))
    const suggested = SUGGESTED_STATUSES.filter(
      s => s.toLowerCase().includes(lowerQuery) && !vaultSet.has(s.toLowerCase()),
    )
    const vault = vaultStatuses.filter(s => s.toLowerCase().includes(lowerQuery))
    return { suggestedFiltered: suggested, vaultFiltered: vault, allFiltered: [...vault, ...suggested] }
  }, [query, vaultStatuses])
}

interface KeyboardNavOptions {
  allFiltered: string[]
  totalOptions: number
  showCreateOption: boolean
  query: string
  onSave: (v: string) => void
  onCancel: () => void
  listRef: React.RefObject<HTMLDivElement | null>
}

interface StatusSelectionOptions {
  highlightIndex: number
  allFiltered: string[]
  showCreateOption: boolean
  query: string
}

function getStatusValueToSave({
  highlightIndex,
  allFiltered,
  showCreateOption,
  query,
}: StatusSelectionOptions) {
  const trimmed = query.trim()
  if (highlightIndex >= 0 && highlightIndex < allFiltered.length) return allFiltered.at(highlightIndex)
  if (showCreateOption && highlightIndex === allFiltered.length) return trimmed
  return trimmed || null
}

function useStatusKeyboard(opts: KeyboardNavOptions) {
  const { allFiltered, totalOptions, showCreateOption, query, onSave, onCancel, listRef } = opts
  const [highlightIndex, setHighlightIndex] = useState(-1)

  const scrollIntoView = useCallback((index: number) => {
    const list = listRef.current
    if (!list) return
    const items = list.querySelectorAll('[data-testid^="status-option-"], [data-testid="status-create-option"]')
    items.item(index)?.scrollIntoView({ block: 'nearest' })
  }, [listRef])

  const moveHighlight = useCallback((nextIndex: number) => {
    setHighlightIndex(nextIndex)
    scrollIntoView(nextIndex)
  }, [scrollIntoView])

  const submitHighlightedStatus = useCallback(() => {
    const value = getStatusValueToSave({ highlightIndex, allFiltered, showCreateOption, query })
    if (value) onSave(value)
  }, [highlightIndex, allFiltered, showCreateOption, query, onSave])

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
          submitHighlightedStatus()
          break
        }
        case 'Escape':
          e.preventDefault()
          onCancel()
          break
      }
    },
    [highlightIndex, totalOptions, moveHighlight, submitHighlightedStatus, onCancel],
  )

  const resetHighlight = useCallback(() => setHighlightIndex(-1), [])

  return { highlightIndex, setHighlightIndex, handleKeyDown, resetHighlight }
}

export function StatusDropdown({
  vaultStatuses,
  onSave,
  onCancel,
}: {
  value: string
  vaultStatuses: string[]
  onSave: (newValue: string) => void
  onCancel: () => void
}) {
  const [query, setQuery] = useState('')
  const [colorEditingStatus, setColorEditingStatus] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useAnchoredDropdownPosition({ anchorRef, dropdownRef, width: PROPERTY_DROPDOWN_WIDTH })
  useAutoFocus(inputRef)

  const { suggestedFiltered, vaultFiltered, allFiltered } = useStatusFiltering(query, vaultStatuses)

  const showCreateOption = useMemo(() => isCreateOptionVisible(query, allFiltered), [query, allFiltered])

  const totalOptions = allFiltered.length + (showCreateOption ? 1 : 0)

  const { highlightIndex, setHighlightIndex, handleKeyDown, resetHighlight } =
    useStatusKeyboard({ allFiltered, totalOptions, showCreateOption, query, onSave, onCancel, listRef })

  const handleToggleColor = useCallback((status: string) => {
    setColorEditingStatus(prev => prev === status ? null : status)
  }, [])

  const handleColorChange = useCallback((status: string, colorKey: string) => {
    const currentKey = getStatusColorKey(status)
    setStatusColor(status, currentKey === colorKey ? null : colorKey)
    setColorEditingStatus(null)
  }, [])

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    resetHighlight()
  }, [resetHighlight])

  const optionProps: StatusOptionProps = {
    highlightOffset: 0,
    highlightIndex,
    colorEditingStatus,
    onSelect: onSave,
    onHighlight: setHighlightIndex,
    onToggleColor: handleToggleColor,
    onColorChange: handleColorChange,
  }

  return (
    <span ref={anchorRef} data-testid="status-dropdown">
      {createPortal(
        <>
          <button
            type="button"
            aria-label="Close status menu"
            className="fixed inset-0 z-[12000] cursor-default border-0 bg-transparent p-0"
            onClick={onCancel}
            data-testid="status-dropdown-backdrop"
          />
          <div
            ref={dropdownRef}
            className="fixed z-[12001] w-52 overflow-hidden rounded-lg border border-border bg-background shadow-lg"
            data-testid="status-dropdown-popover"
          >
            <div className="border-b border-border px-2 py-1.5">
              <input
                ref={inputRef}
                className="w-full border-none bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
                placeholder="Type a status..."
                value={query}
                onChange={e => handleQueryChange(e.target.value)}
                onKeyDown={handleKeyDown}
                data-testid="status-search-input"
              />
            </div>
            <div ref={listRef} className="max-h-52 overflow-y-auto py-1">
              <VaultSection statuses={vaultFiltered} {...optionProps} />
              <SuggestedSection
                statuses={suggestedFiltered}
                showDivider={vaultFiltered.length > 0}
                {...optionProps}
                highlightOffset={vaultFiltered.length}
              />
              <CreateSection
                show={showCreateOption}
                query={query}
                showDivider={allFiltered.length > 0}
                highlighted={highlightIndex === allFiltered.length}
                onSave={onSave}
                onMouseEnter={() => setHighlightIndex(allFiltered.length)}
              />
              {allFiltered.length === 0 && !showCreateOption && (
                <div className="px-2 py-2 text-center text-[11px] text-muted-foreground">
                  No matching statuses
                </div>
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </span>
  )
}

function VaultSection({ statuses, ...props }: StatusOptionProps & { statuses: string[] }) {
  if (statuses.length === 0) return null
  return (
    <div>
      <SectionLabel>From vault</SectionLabel>
      <StatusOptionList statuses={statuses} {...props} />
    </div>
  )
}

function SuggestedSection({ statuses, showDivider, ...props }: StatusOptionProps & { statuses: string[]; showDivider: boolean }) {
  if (statuses.length === 0) return null
  return (
    <div>
      {showDivider && <div className="my-1 h-px bg-border" />}
      <SectionLabel>Suggested</SectionLabel>
      <StatusOptionList statuses={statuses} {...props} />
    </div>
  )
}

function CreateSection({ show, query, showDivider, highlighted, onSave, onMouseEnter }: {
  show: boolean; query: string; showDivider: boolean; highlighted: boolean
  onSave: (v: string) => void; onMouseEnter: () => void
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
        onClick={() => onSave(trimmed)}
        onMouseEnter={onMouseEnter}
        data-testid="status-create-option"
      >
        Create <StatusPill status={trimmed} />
      </button>
    </>
  )
}
