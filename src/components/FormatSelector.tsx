import { Browsers, CaretUpDown, Check, FileText, Table } from '@phosphor-icons/react'
import { useId, useState, type KeyboardEvent } from 'react'
import type { FrontmatterValue } from './Inspector'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { translate, type AppLocale } from '../lib/i18n'
import {
  LEGACY_NOTE_FORMAT_FRONTMATTER_KEY,
  NOTE_FORMAT_FRONTMATTER_KEY,
  NOTE_FORMAT_SHEET,
  NOTE_FORMAT_TEXT,
  type NoteFormat,
} from '../utils/noteFormat'
import { PROPERTY_CHIP_STYLE } from './propertyChipStyles'
import {
  PROPERTY_PANEL_LABEL_CLASS_NAME,
  PROPERTY_PANEL_LABEL_ICON_SLOT_CLASS_NAME,
  PROPERTY_PANEL_ROW_STYLE,
} from './propertyPanelLayout'

const FORMAT_OPTIONS = [NOTE_FORMAT_TEXT, NOTE_FORMAT_SHEET] as const
const OPEN_COMBOBOX_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Enter', ' '])

interface FormatSelectorProps {
  format: NoteFormat
  locale?: AppLocale
  onDeleteProperty?: (key: string) => void
  onUpdateProperty?: (key: string, value: FrontmatterValue) => void
}

function initialHighlightedIndex(format: NoteFormat): number {
  const index = FORMAT_OPTIONS.indexOf(format)
  return index >= 0 ? index : 0
}

function stepHighlightedIndex(current: number, direction: 'next' | 'previous'): number {
  if (current < 0) return direction === 'next' ? 0 : FORMAT_OPTIONS.length - 1
  return direction === 'next'
    ? (current + 1) % FORMAT_OPTIONS.length
    : (current - 1 + FORMAT_OPTIONS.length) % FORMAT_OPTIONS.length
}

function shouldOpenCombobox(event: KeyboardEvent<HTMLButtonElement>): boolean {
  return OPEN_COMBOBOX_KEYS.has(event.key)
}

function formatLabel(format: NoteFormat, locale: AppLocale): string {
  return translate(locale, format === NOTE_FORMAT_SHEET
    ? 'inspector.properties.formatSheet'
    : 'inspector.properties.formatText')
}

function FormatIcon({ format }: { format: NoteFormat }) {
  const Icon = format === NOTE_FORMAT_SHEET ? Table : FileText
  return <Icon size={14} className="shrink-0" aria-hidden="true" />
}

function FormatRowLabel({ locale }: { locale: AppLocale }) {
  return (
    <span className={PROPERTY_PANEL_LABEL_CLASS_NAME}>
      <span
        className={PROPERTY_PANEL_LABEL_ICON_SLOT_CLASS_NAME}
        data-testid="format-row-icon-slot"
      >
        <Browsers size={14} className="shrink-0" aria-hidden="true" />
      </span>
      <span className="min-w-0 truncate">{translate(locale, 'inspector.properties.displayAs')}</span>
    </span>
  )
}

function ReadOnlyFormatSelector({ format, locale }: { format: NoteFormat; locale: AppLocale }) {
  return (
    <div className="grid min-h-7 min-w-0 grid-cols-2 items-center gap-2 px-1.5" style={PROPERTY_PANEL_ROW_STYLE}>
      <FormatRowLabel locale={locale} />
      <div className="flex min-w-0 items-center justify-start">
        <span
          className="inline-flex min-w-0 max-w-full items-center gap-1 truncate text-[12px] font-medium"
          style={PROPERTY_CHIP_STYLE}
          title={formatLabel(format, locale)}
        >
          <FormatIcon format={format} />
          <span className="min-w-0 truncate">{formatLabel(format, locale)}</span>
        </span>
      </div>
    </div>
  )
}

function EditableFormatSelector({
  format,
  locale,
  onDeleteProperty,
  onUpdateProperty,
}: Required<Pick<FormatSelectorProps, 'format' | 'locale' | 'onDeleteProperty' | 'onUpdateProperty'>>) {
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(() => initialHighlightedIndex(format))
  const listboxId = useId()

  const updateFormat = (nextFormat: NoteFormat) => {
    if (nextFormat === format) return
    if (nextFormat === NOTE_FORMAT_TEXT) {
      onDeleteProperty(NOTE_FORMAT_FRONTMATTER_KEY)
      onDeleteProperty(LEGACY_NOTE_FORMAT_FRONTMATTER_KEY)
      return
    }
    onUpdateProperty(NOTE_FORMAT_FRONTMATTER_KEY, NOTE_FORMAT_SHEET)
    onDeleteProperty(LEGACY_NOTE_FORMAT_FRONTMATTER_KEY)
  }

  const openCombobox = () => {
    setHighlightedIndex(initialHighlightedIndex(format))
    setOpen(true)
  }

  const closeCombobox = () => setOpen(false)

  const selectFormat = (nextFormat: NoteFormat) => {
    updateFormat(nextFormat)
    closeCombobox()
  }

  const moveHighlight = (direction: 'next' | 'previous') => {
    setHighlightedIndex((current) => stepHighlightedIndex(current, direction))
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      openCombobox()
      return
    }
    closeCombobox()
  }

  const handleOpenTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        moveHighlight('next')
        return
      case 'ArrowUp':
        event.preventDefault()
        moveHighlight('previous')
        return
      case 'Enter':
      case ' ':
        event.preventDefault()
        selectFormat(FORMAT_OPTIONS[highlightedIndex] ?? format)
        return
      case 'Escape':
        event.preventDefault()
        closeCombobox()
        return
      default:
        return
    }
  }

  const handleClosedTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!shouldOpenCombobox(event)) return
    event.preventDefault()
    openCombobox()
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (open) {
      handleOpenTriggerKeyDown(event)
      return
    }
    handleClosedTriggerKeyDown(event)
  }

  return (
    <div
      className="grid min-h-7 min-w-0 grid-cols-2 items-center gap-2 px-1.5"
      style={PROPERTY_PANEL_ROW_STYLE}
      data-testid="format-selector"
    >
      <FormatRowLabel locale={locale} />
      <div className="flex min-w-0 items-center justify-start">
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              role="combobox"
              aria-controls={listboxId}
              aria-expanded={open}
              aria-haspopup="listbox"
              aria-label={translate(locale, 'inspector.properties.displayAs')}
              aria-activedescendant={open ? `${listboxId}-${highlightedIndex}` : undefined}
              className={cn(
                'h-auto max-w-full justify-between gap-1 border-none px-2 shadow-none ring-inset [&_svg]:text-current hover:ring-1 hover:ring-current',
              )}
              style={PROPERTY_CHIP_STYLE}
              onKeyDown={handleTriggerKeyDown}
            >
              <span className="flex min-w-0 items-center gap-1 truncate">
                <FormatIcon format={format} />
                <span className="min-w-0 truncate">{formatLabel(format, locale)}</span>
              </span>
              <CaretUpDown size={14} aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="left"
            sideOffset={4}
            className="w-40 overflow-hidden p-1"
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <div id={listboxId} role="listbox">
              {FORMAT_OPTIONS.map((option, index) => {
                const selected = option === format
                const highlighted = index === highlightedIndex
                return (
                  <Button
                    id={`${listboxId}-${index}`}
                    key={option}
                    type="button"
                    variant="ghost"
                    size="sm"
                    role="option"
                    aria-selected={selected}
                    className={cn(
                      'h-auto w-full justify-between px-2 py-1.5 text-left font-normal',
                      highlighted && 'bg-muted',
                    )}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => selectFormat(option)}
                  >
                    <span className="flex min-w-0 items-center gap-2 truncate">
                      <FormatIcon format={option} />
                      <span>{formatLabel(option, locale)}</span>
                    </span>
                    {selected ? <Check size={14} aria-hidden="true" /> : null}
                  </Button>
                )
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

export function FormatSelector({
  format,
  locale = 'en',
  onDeleteProperty,
  onUpdateProperty,
}: FormatSelectorProps) {
  if (!onUpdateProperty || !onDeleteProperty) {
    return <ReadOnlyFormatSelector format={format} locale={locale} />
  }

  return (
    <EditableFormatSelector
      format={format}
      locale={locale}
      onDeleteProperty={onDeleteProperty}
      onUpdateProperty={onUpdateProperty}
    />
  )
}
