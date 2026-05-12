import { useState, useCallback, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight } from '@phosphor-icons/react'
import type { FrontmatterValue } from './Inspector'
import { EditableValue, TagPillList, UrlValue } from './EditableValue'
import { isUrlValue } from '../utils/url'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { XIcon } from 'lucide-react'
import { trackDatePropertyDirectEntrySaved } from '../lib/productAnalytics'
import { translate, type AppLocale } from '../lib/i18n'
import { isValidCssColor } from '../utils/colorUtils'
import {
  type PropertyDisplayMode,
  formatDateValue,
  toISODate,
  DISPLAY_MODE_OPTIONS,
  DISPLAY_MODE_ICONS,
} from '../utils/propertyTypes'
import { StatusDropdown } from './StatusDropdown'
import { getStatusStyle } from '../utils/statusStyles'
import { TagsDropdown } from './TagsDropdown'
import { getTagStyle } from '../utils/tagStyles'
import { ColorEditableValue } from './ColorInput'
import { IconEditableValue } from './IconEditableValue'
import { PROPERTY_CHIP_STYLE } from './propertyChipStyles'
import { canonicalSystemMetadataKey } from '../utils/systemMetadata'
import { useDateDisplayFormat } from '../hooks/useAppPreferences'

const ISO_DATE_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DEFAULT_DATE_PICKER_START_YEAR = 1800
const DEFAULT_DATE_PICKER_END_YEAR = 2200

function localDate(year: number, monthIndex: number, day: number): Date {
  const date = new Date(0)
  date.setFullYear(year, monthIndex, day)
  date.setHours(0, 0, 0, 0)
  return date
}

function dateToISO(day: Date): string {
  const yyyy = String(day.getFullYear()).padStart(4, '0')
  const mm = String(day.getMonth() + 1).padStart(2, '0')
  const dd = String(day.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function parseDateInput(value: string): string | null {
  const trimmed = value.trim()
  const match = ISO_DATE_INPUT_RE.exec(trimmed)
  if (!match) return null

  const year = Number(match[1])
  if (year < 1) return null

  const date = localDate(year, Number(match[2]) - 1, Number(match[3]))
  return dateToISO(date) === trimmed ? trimmed : null
}

function dateFromISO(value: string): Date | undefined {
  const iso = parseDateInput(value)
  if (!iso) return undefined
  const match = ISO_DATE_INPUT_RE.exec(iso)
  if (!match) return undefined
  return localDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function parseDateValue(value: string): Date | undefined {
  return dateFromISO(toISODate(value))
}

function datePickerStartMonth(selectedDate: Date | undefined): Date {
  const selectedYear = selectedDate?.getFullYear()
  const year = selectedYear && selectedYear < DEFAULT_DATE_PICKER_START_YEAR
    ? selectedYear
    : DEFAULT_DATE_PICKER_START_YEAR
  return localDate(year, 0, 1)
}

function datePickerEndMonth(selectedDate: Date | undefined): Date {
  const selectedYear = selectedDate?.getFullYear()
  const year = selectedYear && selectedYear > DEFAULT_DATE_PICKER_END_YEAR
    ? selectedYear
    : DEFAULT_DATE_PICKER_END_YEAR
  return localDate(year, 11, 31)
}

const RELATIONSHIP_PROPERTY_KEYS = new Set(['belongs_to', 'related_to', 'has'])

function normalizePropertyKey(propKey: string): string {
  return propKey.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function showsRelationshipPropertyIcon(propKey: string): boolean {
  return RELATIONSHIP_PROPERTY_KEYS.has(normalizePropertyKey(propKey))
}

function StatusValue({ propKey, value, isEditing, vaultStatuses, onSave, onStartEdit }: {
  propKey: string; value: FrontmatterValue; isEditing: boolean; vaultStatuses: string[]
  onSave: (key: string, value: string) => void; onStartEdit: (key: string | null) => void
}) {
  const statusStr = String(value)
  const style = getStatusStyle(statusStr)
  return (
    <span className="relative inline-flex min-w-0 items-center">
      <span
        className="inline-flex cursor-pointer items-center gap-1.5 transition-opacity hover:opacity-80"
        style={{ ...PROPERTY_CHIP_STYLE, backgroundColor: style.bg, color: style.color }}
        onClick={() => onStartEdit(propKey)}
        data-testid="status-badge"
      >
        <span className="inline-block size-1.5 shrink-0 rounded-full" style={{ backgroundColor: style.color }} />
        {statusStr}
      </span>
      {isEditing && (
        <StatusDropdown
          value={statusStr}
          vaultStatuses={vaultStatuses}
          onSave={(newValue) => onSave(propKey, newValue)}
          onCancel={() => onStartEdit(null)}
        />
      )}
    </span>
  )
}

function TagsValue({ propKey, value, isEditing, vaultTags, onSave, onStartEdit }: {
  propKey: string; value: string[]; isEditing: boolean; vaultTags: string[]
  onSave: (key: string, items: string[]) => void; onStartEdit: (key: string | null) => void
}) {
  const handleToggle = useCallback((tag: string) => {
    const idx = value.indexOf(tag)
    const next = idx >= 0 ? value.filter((_, i) => i !== idx) : [...value, tag]
    onSave(propKey, next)
  }, [propKey, value, onSave])

  const handleRemove = useCallback((tag: string) => {
    onSave(propKey, value.filter(t => t !== tag))
  }, [propKey, value, onSave])

  return (
    <span className="relative inline-flex min-w-0 flex-wrap items-center gap-1">
      {value.map(tag => {
        const style = getTagStyle(tag)
        return (
          <span
            key={tag}
            className="group/tag relative inline-flex items-center overflow-hidden"
            style={{ ...PROPERTY_CHIP_STYLE, backgroundColor: style.bg, maxWidth: 120 }}
          >
            <span
              className="transition-[max-width] duration-150 group-hover/tag:[mask-image:linear-gradient(to_right,black_60%,transparent_100%)]"
              style={{
                color: style.color,
                overflow: 'hidden',
                whiteSpace: 'nowrap' as const,
              }}
            >
              {tag}
            </span>
            <button
              className="ml-0.5 max-w-0 overflow-hidden border-none bg-transparent p-0 leading-none opacity-0 transition-all duration-150 group-hover/tag:max-w-[14px] group-hover/tag:opacity-100"
              style={{ color: style.color, fontSize: 11, flexShrink: 0 }}
              onClick={() => handleRemove(tag)}
              title={`Remove ${tag}`}
            >
              &times;
            </button>
          </span>
        )
      })}
      <button
        className="inline-flex shrink-0 items-center justify-center border-none bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        style={PROPERTY_CHIP_STYLE}
        onClick={() => onStartEdit(propKey)}
        title="Add tag"
        data-testid="tags-add-button"
      >+</button>
      {isEditing && (
        <TagsDropdown
          selectedTags={value}
          vaultTags={vaultTags}
          onToggle={handleToggle}
          onClose={() => onStartEdit(null)}
        />
      )}
    </span>
  )
}

function BooleanToggle({ value, onToggle }: { value: boolean; onToggle: () => void }) {
  return (
    <label className="inline-flex h-6 cursor-pointer items-center gap-1.5" data-testid="boolean-toggle">
      <input
        type="checkbox"
        checked={value}
        onChange={onToggle}
        className="size-3.5 cursor-pointer accent-primary"
      />
      <span className="text-[12px] text-secondary-foreground">{value ? 'Yes' : 'No'}</span>
    </label>
  )
}

function NumberValue({
  value,
  onSave,
  onCancel,
  isEditing,
  onStartEdit,
}: ScalarEditProps) {
  const [editValue, setEditValue] = useState(value)

  const restoreValue = useCallback(() => {
    setEditValue(value)
  }, [value])

  const commitValue = useCallback(() => {
    const trimmed = editValue.trim()
    if (trimmed === '') {
      onSave('')
      return
    }

    const parsed = Number(trimmed)
    if (Number.isFinite(parsed)) {
      onSave(trimmed)
      return
    }

    restoreValue()
    onCancel()
  }, [editValue, onCancel, onSave, restoreValue])

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commitValue()
      return
    }

    if (event.key === 'Escape') {
      restoreValue()
      onCancel()
    }
  }, [commitValue, onCancel, restoreValue])

  if (isEditing) {
    return (
      <Input
        className="h-7 w-full border-ring bg-muted px-2 py-1 text-left font-mono text-[12px] tabular-nums"
        type="text"
        inputMode="decimal"
        value={editValue}
        onChange={(event) => setEditValue(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commitValue}
        autoFocus
        data-testid="number-input"
      />
    )
  }

  return (
    <button
      type="button"
      className="inline-flex h-6 w-full min-w-0 items-center justify-start overflow-hidden rounded-md border-none bg-muted/60 px-2 text-left font-mono text-[12px] tabular-nums text-foreground transition-colors hover:bg-muted"
      onClick={onStartEdit}
      title={value || 'Click to edit'}
      data-testid="number-display"
    >
      <span className="min-w-0 truncate">{value || '\u2014'}</span>
    </button>
  )
}

function DateValue({ value, onSave, locale = 'en', autoOpen = false, onCancel }: {
  value: string
  onSave: (newValue: string) => void
  locale?: AppLocale
  autoOpen?: boolean
  onCancel?: () => void
}) {
  const dateDisplayFormat = useDateDisplayFormat()
  const [open, setOpen] = useState(autoOpen)
  const formatted = formatDateValue(value, dateDisplayFormat)
  const pickDateLabel = translate(locale, 'inspector.properties.pickDate')
  const selectedDate = parseDateValue(value)
  const selectedIso = selectedDate ? dateToISO(selectedDate) : ''
  const [draftValue, setDraftValue] = useState(selectedIso)
  const [invalidDraft, setInvalidDraft] = useState(false)

  const resetDraft = () => {
    setDraftValue(selectedIso)
    setInvalidDraft(false)
  }

  const closeWithoutSave = () => {
    resetDraft()
    setOpen(false)
    onCancel?.()
  }

  const commitDraftValue = () => {
    if (draftValue.trim() === '') {
      if (value) onSave('')
      else closeWithoutSave()
      setOpen(false)
      return
    }

    const parsed = parseDateInput(draftValue)
    if (!parsed) {
      setInvalidDraft(true)
      return
    }

    onSave(parsed)
    trackDatePropertyDirectEntrySaved()
    setOpen(false)
  }

  const handleSelect = (day: Date | undefined) => {
    if (day) onSave(dateToISO(day))
    setOpen(false)
  }

  const handleClear = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    onSave('')
    setOpen(false)
  }

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setDraftValue(event.target.value)
    if (invalidDraft) setInvalidDraft(false)
  }

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitDraftValue()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closeWithoutSave()
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) resetDraft()
        setOpen(nextOpen)
        if (!nextOpen) onCancel?.()
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className={`min-w-0 justify-start border-none text-left transition-colors hover:opacity-80${formatted ? ' bg-muted text-accent-foreground' : ' bg-transparent text-muted-foreground'}`}
          style={PROPERTY_CHIP_STYLE}
          title={value}
          data-testid="date-display"
        >
          <span className={`min-w-0 truncate${!formatted ? ' text-muted-foreground' : ''}`}>{formatted || pickDateLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto overflow-hidden p-0" align="end" side="bottom" data-testid="date-picker-popover">
        <div className="border-b p-2">
          <Input
            className="h-8 w-full min-w-[8.75rem] border-ring bg-background px-2 py-1 text-left font-mono text-[13px] tabular-nums"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
            placeholder="YYYY-MM-DD"
            aria-label={pickDateLabel}
            aria-invalid={invalidDraft ? 'true' : undefined}
            value={draftValue}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            autoFocus
            data-testid="date-picker-input"
          />
        </div>
        <div className="pb-8">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleSelect}
            defaultMonth={selectedDate}
            captionLayout="dropdown"
            navLayout="after"
            startMonth={datePickerStartMonth(selectedDate)}
            endMonth={datePickerEndMonth(selectedDate)}
            data-testid="date-picker-calendar"
          />
        </div>
        {selectedDate && (
          <div className="relative bg-popover border-t px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="h-7 px-2 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
              onClick={handleClear}
              data-testid="date-picker-clear"
            >
              <XIcon className="size-3" />
              Clear date
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function DisplayModeSelector({ propKey, currentMode, autoMode, onSelect }: {
  propKey: string; currentMode: PropertyDisplayMode; autoMode: PropertyDisplayMode
  onSelect: (key: string, mode: PropertyDisplayMode | null) => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const CurrentIcon = Reflect.get(DISPLAY_MODE_ICONS, currentMode) as typeof DISPLAY_MODE_ICONS.text
  const showRelationshipIcon = showsRelationshipPropertyIcon(propKey)

  const positionMenu = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const menuW = 140
    let left = rect.right - menuW
    if (left < 8) left = 8
    node.style.top = `${rect.bottom + 4}px`
    node.style.left = `${left}px`
  }, [])

  const handleSelect = (mode: PropertyDisplayMode) => {
    if (mode === autoMode) {
      onSelect(propKey, null)
    } else {
      onSelect(propKey, mode)
    }
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded border-none bg-transparent p-0 text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        onClick={() => setOpen(!open)}
        title={`Change ${propKey} type`}
        aria-label={`Change ${propKey} type`}
        data-testid="display-mode-trigger"
      >
        {showRelationshipIcon ? (
          <ArrowUpRight className="size-3.5" data-testid="display-mode-icon-relationship" />
        ) : (
          <CurrentIcon className="size-3.5" data-testid={`display-mode-icon-${currentMode}`} />
        )}
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[12000]" onClick={() => setOpen(false)} />
          <div
            ref={positionMenu}
            className="fixed z-[12001] min-w-[130px] rounded-md border border-border bg-background py-1 shadow-md"
            data-testid="display-mode-menu"
          >
            {DISPLAY_MODE_OPTIONS.map(opt => {
              const OptIcon = DISPLAY_MODE_ICONS[opt.value]
              return (
                <button
                  key={opt.value}
                  className="flex w-full items-center gap-2 border-none bg-transparent px-3 py-1.5 text-left text-[12px] text-foreground transition-colors hover:bg-muted"
                  onClick={() => handleSelect(opt.value)}
                  data-testid={`display-mode-option-${opt.value}`}
                >
                  <span className="w-3 text-center text-[10px]">
                    {currentMode === opt.value ? '\u2713' : ''}
                  </span>
                  <OptIcon className="size-3.5 text-muted-foreground" />
                  {opt.label}
                  {opt.value === autoMode && (
                    <span className="ml-auto text-[10px] text-muted-foreground">auto</span>
                  )}
                </button>
              )
            })}
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

function toBooleanValue(value: FrontmatterValue): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.toLowerCase() === 'true'
  return false
}

function autoDetectFromValue(propKey: string, value: FrontmatterValue): PropertyDisplayMode {
  if (canonicalSystemMetadataKey(propKey) === '_icon') return 'text'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string' && isUrlValue(value)) return 'url'
  if (typeof value === 'string' && isValidCssColor(value) && value.startsWith('#')) return 'color'
  return 'text'
}

type SmartCellProps = {
  propKey: string; value: FrontmatterValue; displayMode: PropertyDisplayMode; isEditing: boolean
  locale?: AppLocale
  vaultStatuses: string[]; vaultTags: string[]
  onStartEdit: (key: string | null) => void; onSave: (key: string, value: string) => void
  onSaveList: (key: string, items: string[]) => void; onUpdate?: (key: string, value: FrontmatterValue) => void
}

interface ScalarEditProps {
  value: string
  isEditing: boolean
  onStartEdit: () => void
  onSave: (nextValue: string) => void
  onCancel: () => void
}

function createScalarEditProps({
  propKey,
  value,
  isEditing,
  onStartEdit,
  onSave,
}: {
  propKey: string
  value: FrontmatterValue
  isEditing: boolean
  onStartEdit: (key: string | null) => void
  onSave: (key: string, value: string) => void
}): ScalarEditProps {
  return {
    value: String(value ?? ''),
    isEditing,
    onStartEdit: () => onStartEdit(propKey),
    onSave: (nextValue: string) => onSave(propKey, nextValue),
    onCancel: () => onStartEdit(null),
  }
}

type ScalarRendererProps = SmartCellProps & {
  editProps: ScalarEditProps
}

type ScalarDisplayRenderer = (props: ScalarRendererProps & { resolvedMode: PropertyDisplayMode }) => ReactNode

const SCALAR_DISPLAY_RENDERERS: readonly [PropertyDisplayMode, ScalarDisplayRenderer][] = [
  ['status', (props) => (
    <StatusValue
      propKey={props.propKey}
      value={props.value ?? ''}
      isEditing={props.isEditing}
      vaultStatuses={props.vaultStatuses}
      onSave={props.onSave}
      onStartEdit={props.onStartEdit}
    />
  )],
  ['tags', (props) => (
    <TagsValue
      propKey={props.propKey}
      value={props.value ? [String(props.value)] : []}
      isEditing={props.isEditing}
      vaultTags={props.vaultTags}
      onSave={props.onSaveList}
      onStartEdit={props.onStartEdit}
    />
  )],
  ['date', (props) => (
    <DateValue
      key={`${props.propKey}:${props.isEditing ? 'editing' : 'view'}`}
      value={String(props.value ?? '')}
      locale={props.locale}
      onSave={(nextValue) => props.onSave(props.propKey, nextValue)}
      autoOpen={props.isEditing}
      onCancel={() => props.onStartEdit(null)}
    />
  )],
  ['number', (props) => <NumberValue {...props.editProps} />],
  ['boolean', (props) => {
    const boolVal = toBooleanValue(props.value)
    return <BooleanToggle value={boolVal} onToggle={() => props.onUpdate?.(props.propKey, !boolVal)} />
  }],
  ['url', (props) => <UrlValue {...props.editProps} />],
  ['color', (props) => <ColorEditableValue {...props.editProps} />],
]

function renderScalarDisplayMode(props: ScalarRendererProps & { resolvedMode: PropertyDisplayMode }) {
  const renderer = SCALAR_DISPLAY_RENDERERS.find(([mode]) => mode === props.resolvedMode)?.[1]
  return renderer ? renderer(props) : <EditableValue {...props.editProps} />
}

function ScalarValueCell(props: SmartCellProps) {
  const { propKey, value, displayMode, isEditing, onStartEdit, onSave } = props
  const editProps = createScalarEditProps({
    propKey,
    value,
    isEditing,
    onStartEdit,
    onSave,
  })

  if (canonicalSystemMetadataKey(propKey) === '_icon') {
    return <IconEditableValue {...editProps} />
  }

  const resolvedMode = displayMode === 'text' ? autoDetectFromValue(propKey, value) : displayMode
  return renderScalarDisplayMode({ ...props, resolvedMode, editProps })
}

export function SmartPropertyValueCell(props: SmartCellProps) {
  const { propKey, value, displayMode, isEditing, vaultTags, onSaveList, onStartEdit } = props
  if (Array.isArray(value)) {
    if (displayMode === 'tags') {
      return <TagsValue propKey={propKey} value={value.map(String)} isEditing={isEditing} vaultTags={vaultTags} onSave={onSaveList} onStartEdit={onStartEdit} />
    }
    return <TagPillList items={value.map(String)} onSave={(items) => onSaveList(propKey, items)} label={propKey} />
  }
  return <ScalarValueCell {...props} />
}
