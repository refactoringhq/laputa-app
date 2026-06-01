import { Fragment, createElement, useEffect, useImperativeHandle, useRef } from 'react'
import type { CSSProperties } from 'react'
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

function withNativeEvent<T extends Event>(event: T): T & { nativeEvent: T } {
  const eventWithNativeEvent = event as T & { nativeEvent?: T }
  if (!eventWithNativeEvent.nativeEvent) {
    Object.defineProperty(event, 'nativeEvent', {
      configurable: true,
      value: event,
    })
  }
  return event as T & { nativeEvent: T }
}

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
    <button
      type="button"
      className={cn(
        'mx-1 flex w-[calc(100%-0.5rem)] cursor-pointer items-center justify-between rounded-md border-0 bg-transparent px-3 py-2 text-left transition-colors',
        selected ? 'bg-accent' : 'hover:bg-secondary',
      )}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      onMouseEnter={onHover}
    >
      <span className="flex min-w-0 items-center gap-2">
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
      </span>
      <span className="ml-3 shrink-0 text-[11px] text-muted-foreground">
        {suggestion.entry.isA ?? 'Note'}
      </span>
    </button>
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
  placeholderClassName,
  editorClassName,
  editorStyle,
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
  placeholderClassName?: string
  editorClassName?: string
  editorStyle?: CSSProperties
  onCompositionEnd: (editor: HTMLDivElement) => void
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
  const editorRef = useRef<HTMLDivElement | null>(null)
  const needsTrailingCaretAnchor = segments[segments.length - 1]?.kind === 'chip'
  useImperativeHandle(inputRef, () => editorRef.current as HTMLDivElement, [])
  useInlineWikilinkPlaceholder(editorRef, placeholder)
  useInlineWikilinkEditorEvents(editorRef, {
    onCompositionEnd,
    onCompositionStart,
    onCut,
    onDrop,
    onInput,
    onKeyDown,
    onPaste,
    onSelectionChange,
  })

  return (
    <div className="relative">
      {value.length === 0 && placeholder && (
        <div
          className={cn(
            'pointer-events-none absolute inset-0 text-muted-foreground',
            placeholderClassName ?? 'flex items-center',
          )}
          style={placeholderClassName ? undefined : { padding: '8px 10px', fontSize: 13 }}
        >
          {placeholder}
        </div>
      )}
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning={true}
        aria-disabled={disabled ? 'true' : undefined}
        data-testid={dataTestId}
        className={cn(
          'min-h-[34px] w-full rounded-lg border border-border bg-transparent px-[10px] py-[8px] text-[13px] text-foreground outline-none',
          disabled && 'cursor-not-allowed opacity-60',
          editorClassName,
        )}
        style={{ ...editorStyle, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >
        {segments.map((segment) => renderInlineWikilinkSegment(segment, typeEntryMap))}
        {needsTrailingCaretAnchor ? '\u200B' : null}
      </div>
    </div>
  )
}

type InlineWikilinkEditorHandlers = Pick<
  Parameters<typeof InlineWikilinkEditorField>[0],
  | 'onCompositionEnd'
  | 'onCompositionStart'
  | 'onCut'
  | 'onDrop'
  | 'onInput'
  | 'onKeyDown'
  | 'onPaste'
  | 'onSelectionChange'
>

function useInlineWikilinkPlaceholder(editorRef: React.RefObject<HTMLDivElement | null>, placeholder?: string) {
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    syncPlaceholderAttribute(editor, placeholder)
  }, [editorRef, placeholder])
}

function syncPlaceholderAttribute(editor: HTMLDivElement, placeholder?: string) {
  if (placeholder) {
    editor.setAttribute('aria-placeholder', placeholder)
    return
  }
  editor.removeAttribute('aria-placeholder')
}

function useInlineWikilinkEditorEvents(
  editorRef: React.RefObject<HTMLDivElement | null>,
  handlers: InlineWikilinkEditorHandlers,
) {
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const listenerMap = inlineWikilinkEditorListenerMap(handlers)
    for (const [eventName, listener] of listenerMap) editor.addEventListener(eventName, listener)
    return () => {
      for (const [eventName, listener] of listenerMap) editor.removeEventListener(eventName, listener)
    }
  }, [editorRef, handlers])
}

function inlineWikilinkEditorListenerMap({
  onCompositionEnd,
  onCompositionStart,
  onCut,
  onDrop,
  onInput,
  onKeyDown,
  onPaste,
  onSelectionChange,
}: InlineWikilinkEditorHandlers): Array<[keyof HTMLElementEventMap, EventListener]> {
  const handleSelectionChange = () => onSelectionChange()
  return [
    ['compositionstart', () => onCompositionStart()],
    ['compositionend', (event) => onCompositionEnd(event.currentTarget as HTMLDivElement)],
    ['input', () => onInput()],
    ['keydown', (event) => onKeyDown(withNativeEvent(event) as unknown as React.KeyboardEvent<HTMLDivElement>)],
    ['cut', (event) => onCut(withNativeEvent(event) as unknown as React.ClipboardEvent<HTMLDivElement>)],
    ['drop', (event) => onDrop(withNativeEvent(event) as unknown as React.DragEvent<HTMLDivElement>)],
    ['paste', (event) => onPaste(withNativeEvent(event) as unknown as React.ClipboardEvent<HTMLDivElement>)],
    ['click', handleSelectionChange],
    ['keyup', handleSelectionChange],
    ['mouseup', handleSelectionChange],
  ]
}

function renderInlineWikilinkSegment(segment: InlineWikilinkSegment, typeEntryMap: Record<string, VaultEntry>) {
  if (segment.kind === 'text') return <Fragment key={`text-${segment.text}`}>{segment.text}</Fragment>
  return (
    <InlineWikilinkChipView
      key={`chip-${segment.chip.entry.path}-${segment.chip.target}`}
      chip={segment.chip}
      typeEntryMap={typeEntryMap}
    />
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
