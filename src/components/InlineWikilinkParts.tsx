import { Fragment, createElement } from 'react'
import type { VaultEntry } from '../types'
import { getTypeColor, getTypeLightColor } from '../utils/typeColors'
import { NoteTitleIcon } from './NoteTitleIcon'
import { getTypeIcon } from './note-item/typeIcon'
import type {
  InlineWikilinkChip,
  InlineWikilinkSegment,
} from './inlineWikilinkText'
import type { InlineWikilinkSuggestion } from './inlineWikilinkSuggestions'
import { cn } from '@/lib/utils'

export function InlineWikilinkChipView({
  chip,
  typeEntryMap,
}: {
  chip: InlineWikilinkChip
  typeEntryMap: Record<string, VaultEntry>
}) {
  const typeEntry = chip.entry.isA ? typeEntryMap[chip.entry.isA] : undefined
  const color = getTypeColor(chip.entry.isA, typeEntry?.color)
  const backgroundColor = getTypeLightColor(chip.entry.isA, typeEntry?.color)
  const typeIcon = getTypeIcon(chip.entry.isA, typeEntry?.icon)

  return (
    <span
      contentEditable={false}
      data-chip-target={chip.target}
      data-testid="inline-wikilink-chip"
      className="mx-[1px] inline-flex max-w-full items-center gap-1 rounded-full align-baseline"
      style={{
        backgroundColor,
        color,
        padding: '1px 8px 1px 6px',
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1.5,
      }}
    >
      {chip.entry.icon ? (
        <NoteTitleIcon icon={chip.entry.icon} size={11} color={color} />
      ) : (
        createElement(typeIcon, {
          'aria-hidden': true,
          width: 11,
          height: 11,
          className: 'shrink-0',
        })
      )}
      <span className="truncate">{chip.entry.title}</span>
    </span>
  )
}

function InlineSuggestionRow({
  suggestion,
  selected,
  onHover,
  onSelect,
  typeEntryMap,
}: {
  suggestion: InlineWikilinkSuggestion
  selected: boolean
  onHover: () => void
  onSelect: () => void
  typeEntryMap: Record<string, VaultEntry>
}) {
  const typeEntry = suggestion.entry.isA ? typeEntryMap[suggestion.entry.isA] : undefined
  const color = getTypeColor(suggestion.entry.isA, typeEntry?.color)
  const backgroundColor = getTypeLightColor(suggestion.entry.isA, typeEntry?.color)
  const typeIcon = getTypeIcon(suggestion.entry.isA, typeEntry?.icon)

  return (
    <div
      className={cn(
        'mx-1 flex cursor-pointer items-center justify-between rounded-md px-3 py-2 transition-colors',
        selected ? 'bg-accent' : 'hover:bg-secondary',
      )}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      onMouseEnter={onHover}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor, color }}
        >
          {suggestion.entry.icon ? (
            <NoteTitleIcon icon={suggestion.entry.icon} size={11} color={color} />
          ) : (
            createElement(typeIcon, {
              'aria-hidden': true,
              width: 11,
              height: 11,
              className: 'shrink-0',
            })
          )}
        </span>
        <span className="truncate text-sm text-foreground">{suggestion.title}</span>
      </div>
      <span className="ml-3 shrink-0 text-[11px] text-muted-foreground">
        {suggestion.entry.isA ?? 'Note'}
      </span>
    </div>
  )
}

export function InlineWikilinkSuggestionList({
  suggestions,
  selectedIndex,
  onHover,
  onSelect,
  typeEntryMap,
  variant = 'floating',
  emptyLabel = 'No matching notes',
}: {
  suggestions: InlineWikilinkSuggestion[]
  selectedIndex: number
  onHover: (index: number) => void
  onSelect: (index: number) => void
  typeEntryMap: Record<string, VaultEntry>
  variant?: 'floating' | 'palette'
  emptyLabel?: string
}) {
  if (suggestions.length === 0) {
    return (
      <div className="px-4 py-5 text-center text-[13px] text-muted-foreground">
        {emptyLabel}
      </div>
    )
  }

  return (
    <div
      className={variant === 'floating'
        ? 'absolute bottom-full left-0 right-0 z-10 mb-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-lg'
        : 'py-1'}
      data-testid="wikilink-menu"
    >
      {suggestions.map((suggestion, index) => (
        <InlineSuggestionRow
          key={`${suggestion.entry.path}:${suggestion.target}`}
          suggestion={suggestion}
          selected={index === selectedIndex}
          onHover={() => onHover(index)}
          onSelect={() => onSelect(index)}
          typeEntryMap={typeEntryMap}
        />
      ))}
    </div>
  )
}

export function InlineWikilinkEditorField({
  value,
  placeholder,
  disabled,
  inputRef,
  dataTestId,
  editorClassName,
  onCompositionEnd,
  onCompositionStart,
  onInput,
  onKeyDown,
  onCut,
  onDrop,
  onPaste,
  onSelectionChange,
  segments,
  typeEntryMap,
}: {
  value: string
  placeholder?: string
  disabled: boolean
  inputRef: React.Ref<HTMLDivElement>
  dataTestId: string
  editorClassName?: string
  onCompositionEnd: () => void
  onCompositionStart: () => void
  onInput: () => void
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  onCut: (event: React.ClipboardEvent<HTMLDivElement>) => void
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void
  onPaste: (event: React.ClipboardEvent<HTMLDivElement>) => void
  onSelectionChange: () => void
  segments: InlineWikilinkSegment[]
  typeEntryMap: Record<string, VaultEntry>
}) {
  const needsTrailingCaretAnchor = segments[segments.length - 1]?.kind === 'chip'

  return (
    <div className="relative">
      {value.length === 0 && placeholder && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center text-muted-foreground"
          style={{ padding: '8px 10px', fontSize: 13 }}
        >
          {placeholder}
        </div>
      )}
      <div
        ref={inputRef}
        contentEditable={!disabled}
        suppressContentEditableWarning={true}
        role="textbox"
        aria-multiline="true"
        aria-disabled={disabled || undefined}
        aria-placeholder={placeholder}
        data-testid={dataTestId}
        className={cn(
          'min-h-[34px] w-full rounded-lg border border-border bg-transparent px-[10px] py-[8px] text-[13px] text-foreground outline-none',
          disabled && 'cursor-not-allowed opacity-60',
          editorClassName,
        )}
        onCompositionEnd={onCompositionEnd}
        onCompositionStart={onCompositionStart}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onCut={onCut}
        onDrop={onDrop}
        onPaste={onPaste}
        onClick={onSelectionChange}
        onKeyUp={onSelectionChange}
        onMouseUp={onSelectionChange}
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >
        {segments.map((segment, index) => (
          segment.kind === 'text'
            ? <Fragment key={`text-${index}`}>{segment.text}</Fragment>
            : (
                <InlineWikilinkChipView
                  key={`chip-${segment.chip.entry.path}-${segment.chip.target}`}
                  chip={segment.chip}
                  typeEntryMap={typeEntryMap}
                />
              )
        ))}
        {needsTrailingCaretAnchor ? '\u200B' : null}
      </div>
    </div>
  )
}

export function InlineWikilinkPaletteLayout({
  header,
  editor,
  suggestionList,
  emptyState,
  footer,
}: {
  header?: React.ReactNode
  editor: React.ReactNode
  suggestionList: React.ReactNode
  emptyState?: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <>
      <div className="border-b border-border px-4 py-3">
        {header}
        {editor}
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {suggestionList ?? emptyState}
      </div>
      {footer}
    </>
  )
}
