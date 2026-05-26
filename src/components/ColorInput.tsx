import { useState, useRef, useCallback, useEffect } from 'react'
import { isValidCssColor, toHexColor } from '../utils/colorUtils'

/**
 * Inline color swatch button that opens a native color picker.
 * Shows nothing if the value is not a valid CSS color.
 */
export function ColorSwatch({ color, onChange }: {
  color: string
  onChange?: (hex: string) => void
}) {
  const hex = toHexColor(color) ?? '#000000'
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClick = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange?.(e.target.value)
  }, [onChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      inputRef.current?.click()
    }
  }, [])

  return (
    <span className="inline-flex shrink-0 items-center">
      <button
        type="button"
        className="relative size-4 shrink-0 cursor-pointer rounded-[3px] border border-border p-0 transition-shadow hover:ring-1 hover:ring-primary focus:outline-none focus:ring-2 focus:ring-primary"
        style={{ background: color }}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        title="Open color picker"
        aria-label={`Color: ${color}. Click to open color picker`}
        data-testid="color-swatch"
      >
        <input
          ref={inputRef}
          type="color"
          value={hex}
          onChange={handleChange}
          className="pointer-events-none absolute inset-0 opacity-0"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="color-picker-input"
        />
      </button>
    </span>
  )
}

/**
 * Editable text field with an inline color swatch.
 * The swatch only appears when the value is a valid CSS color.
 */
interface ColorEditableValueProps {
  value: string
  isEditing: boolean
  onStartEdit: () => void
  onSave: (newValue: string) => void
  onCancel: () => void
}

export function ColorEditableValue({ value, isEditing, onStartEdit, onSave, onCancel }: ColorEditableValueProps) {
  const [editValue, setEditValue] = useState(value)
  const showSwatch = isValidCssColor(isEditing ? editValue : value)
  const handlePickerChange = useCallback((hex: string) => {
    if (isEditing) setEditValue(hex)
    onSave(hex)
  }, [isEditing, onSave])

  if (isEditing) {
    return (
      <EditableColorValue
        editValue={editValue}
        onCancel={onCancel}
        onChange={setEditValue}
        onPickerChange={handlePickerChange}
        onSave={onSave}
        showSwatch={showSwatch}
        value={value}
      />
    )
  }

  return (
    <ReadonlyColorValue
      onPickerChange={handlePickerChange}
      onStartEdit={onStartEdit}
      showSwatch={showSwatch}
      value={value}
    />
  )
}

function EditableColorValue({
  editValue,
  onCancel,
  onChange,
  onPickerChange,
  onSave,
  showSwatch,
  value,
}: {
  editValue: string
  onCancel: () => void
  onChange: (value: string) => void
  onPickerChange: (hex: string) => void
  onSave: (newValue: string) => void
  showSwatch: boolean
  value: string
}) {
  const textInputRef = useRef<HTMLInputElement>(null)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onSave(editValue)
    else if (e.key === 'Escape') {
      onChange(value)
      onCancel()
    }
  }

  useEffect(() => {
    textInputRef.current?.focus()
  }, [])

  return (
    <span className="flex w-full items-center gap-1.5">
      {showSwatch && <ColorSwatch color={editValue} onChange={onPickerChange} />}
      <input
        ref={textInputRef}
        className="w-full rounded border border-ring bg-muted px-2 py-1 text-[12px] text-foreground outline-none focus:border-primary"
        type="text"
        value={editValue}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => onSave(editValue)}
        data-testid="color-text-input"
      />
    </span>
  )
}

function ReadonlyColorValue({
  onPickerChange,
  onStartEdit,
  showSwatch,
  value,
}: {
  onPickerChange: (hex: string) => void
  onStartEdit: () => void
  showSwatch: boolean
  value: string
}) {
  return (
    <span className="inline-flex h-6 min-w-0 items-center gap-1.5">
      {showSwatch && <ColorSwatch color={value} onChange={onPickerChange} />}
      <button
        type="button"
        className="min-w-0 cursor-pointer truncate rounded border-0 bg-transparent px-1 text-left text-[12px] text-secondary-foreground transition-colors hover:bg-muted"
        onClick={onStartEdit}
        title={value || 'Click to edit'}
      >
        {value || '\u2014'}
      </button>
    </span>
  )
}
