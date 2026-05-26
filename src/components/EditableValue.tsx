import { useState, useCallback, useEffect, useRef, type ComponentProps } from 'react'
import { normalizeUrl, openExternalUrl } from '../utils/url'
import { getTagStyle } from '../utils/tagStyles'
import { PROPERTY_CHIP_STYLE } from './propertyChipStyles'

function AutoFocusInput(props: ComponentProps<'input'>) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  return <input ref={ref} {...props} />
}

export function UrlValue({
  value,
  onSave,
  onCancel,
  isEditing,
  onStartEdit,
}: {
  value: string
  onSave: (newValue: string) => void
  onCancel: () => void
  isEditing: boolean
  onStartEdit: () => void
}) {
  const [editValue, setEditValue] = useState(value)
  const openingRef = useRef(false)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onSave(editValue)
    } else if (e.key === 'Escape') {
      setEditValue(value)
      onCancel()
    }
  }

  const handleOpen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (openingRef.current) return
    openingRef.current = true
    const normalized = normalizeUrl(value)
    try {
      new URL(normalized)
      openExternalUrl(normalized).catch(() => {
        // opener failed — ignore silently
      })
    } catch {
      // malformed URL — do nothing
    } finally {
      setTimeout(() => { openingRef.current = false }, 500)
    }
  }, [value])

  const handleEditClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onStartEdit()
  }, [onStartEdit])

  if (isEditing) {
    return (
      <AutoFocusInput
        className="w-full rounded border border-ring bg-muted px-2 py-1 text-[12px] text-foreground outline-none focus:border-primary"
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => onSave(editValue)}
      />
    )
  }

  return (
    <span className="group/url flex w-full min-w-0 items-center gap-1">
      <button
        type="button"
        className="inline-flex h-6 min-w-0 flex-1 cursor-pointer items-center justify-start overflow-hidden rounded-md border-0 bg-transparent px-2 text-left text-[12px] text-[var(--accent-blue)] underline decoration-[var(--accent-blue)]/40 transition-colors hover:decoration-[var(--accent-blue)]"
        onClick={handleOpen}
        title={value}
        data-testid="url-link"
      >
        <span className="min-w-0 truncate">{value || '\u2014'}</span>
      </button>
      <button type="button"
        className="shrink-0 border-none bg-transparent p-0 text-[12px] leading-none text-muted-foreground opacity-0 transition-all hover:text-foreground group-hover/url:opacity-100"
        onClick={handleEditClick}
        title="Edit URL"
        data-testid="url-edit-btn"
      >
        &#9998;
      </button>
    </span>
  )
}

export function EditableValue({
  value,
  onSave,
  onCancel,
  isEditing,
  onStartEdit
}: {
  value: string
  onSave: (newValue: string) => void
  onCancel: () => void
  isEditing: boolean
  onStartEdit: () => void
}) {
  const [editValue, setEditValue] = useState(value)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onSave(editValue)
    } else if (e.key === 'Escape') {
      setEditValue(value)
      onCancel()
    }
  }

  if (isEditing) {
    return (
      <AutoFocusInput
        className="w-full rounded border border-ring bg-muted px-2 py-1 text-[12px] text-foreground outline-none focus:border-primary"
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => onSave(editValue)}
      />
    )
  }

  return (
    <button
      type="button"
      className="inline-flex h-6 w-full min-w-0 cursor-pointer items-center justify-start overflow-hidden rounded-md border-0 bg-transparent px-0 text-left text-[12px] text-secondary-foreground transition-colors hover:bg-muted"
      onClick={onStartEdit}
      title={value || 'Click to edit'}
    >
      <span className="min-w-0 truncate">{value || '\u2014'}</span>
    </button>
  )
}

export function TagPillList({
  items,
  onSave,
  label,
}: {
  items: string[]
  onSave: (newItems: string[]) => void
  label: string
}) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [isAddingNew, setIsAddingNew] = useState(false)
  const [newValue, setNewValue] = useState('')

  const handleStartEdit = (index: number) => {
    setEditingIndex(index)
    setEditValue(items.at(index) ?? '')
  }

  const handleSaveEdit = () => {
    if (editingIndex !== null) {
      const newItems = [...items]
      if (editValue.trim()) {
        newItems.splice(editingIndex, 1, editValue.trim())
      } else {
        newItems.splice(editingIndex, 1)
      }
      onSave(newItems)
      setEditingIndex(null)
    }
  }

  const handleDeleteItem = (index: number) => {
    const newItems = items.filter((_, i) => i !== index)
    onSave(newItems)
  }

  const handleAddNew = () => {
    if (newValue.trim()) {
      onSave([...items, newValue.trim()])
      setNewValue('')
      setIsAddingNew(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent, action: 'edit' | 'add') => {
    if (e.key === 'Enter') {
      if (action === 'edit') handleSaveEdit()
      else handleAddNew()
    } else if (e.key === 'Escape') {
      if (action === 'edit') {
        setEditingIndex(null)
        setEditValue('')
      } else {
        setIsAddingNew(false)
        setNewValue('')
      }
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {items.map((item, idx) =>
        editingIndex === idx ? (
          <AutoFocusInput
            key={item}
            className="rounded-full border border-ring bg-muted px-2 py-0.5 text-[11px] text-foreground outline-none focus:border-primary"
            style={{ width: Math.max(60, editValue.length * 7 + 16) }}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, 'edit')}
            onBlur={handleSaveEdit}
          />
        ) : (
          <span
            key={item}
            className="group/pill relative inline-flex max-w-full min-w-0 items-center overflow-hidden transition-colors"
            style={{
              ...PROPERTY_CHIP_STYLE,
              backgroundColor: getTagStyle(item).bg,
              color: getTagStyle(item).color,
            }}
            title="Click to edit"
          >
            <button
              type="button"
              className="min-w-0 truncate border-0 bg-transparent p-0 pr-4 text-left text-[inherit]"
              onClick={() => handleStartEdit(idx)}
            >
              {item}
            </button>
            <button type="button"
              className="absolute right-0.5 top-1/2 flex h-3.5 w-3.5 -translate-y-1/2 items-center justify-center rounded-full border-none p-0 text-[10px] leading-none opacity-0 transition-all hover:bg-[var(--accent-red-light)] hover:text-[var(--accent-red)] group-hover/pill:opacity-100"
              style={{ color: getTagStyle(item).color, backgroundColor: getTagStyle(item).bg }}
              onClick={(e) => {
                e.stopPropagation()
                handleDeleteItem(idx)
              }}
              title="Remove"
            >
              &times;
            </button>
          </span>
        )
      )}
      {isAddingNew ? (
        <AutoFocusInput
          className="rounded-full border border-ring bg-muted px-2 py-0.5 text-[11px] text-foreground outline-none focus:border-primary"
          style={{ width: Math.max(60, newValue.length * 7 + 16) }}
          type="text"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, 'add')}
          onBlur={() => {
            if (newValue.trim()) handleAddNew()
            else { setIsAddingNew(false); setNewValue('') }
          }}
          placeholder={`${label}...`}
        />
      ) : (
        <button type="button"
          className="inline-flex items-center justify-center border-none bg-muted leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          style={PROPERTY_CHIP_STYLE}
          onClick={() => setIsAddingNew(true)}
          title={`Add ${label.toLowerCase()}`}
        >
          +
        </button>
      )}
    </div>
  )
}
