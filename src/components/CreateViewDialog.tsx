import { useState, useRef, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FilterBuilder } from './FilterBuilder'
import { EmojiPicker } from './EmojiPicker'
import type { FilterGroup, ViewDefinition } from '../types'

type SaveViewResult = boolean | void
type SaveViewHandler = (definition: ViewDefinition) => SaveViewResult | Promise<SaveViewResult>
type InitialViewFormValues = Pick<ViewDefinition, 'name' | 'icon' | 'color' | 'filters'>

interface CreateViewDialogProps {
  open: boolean
  onClose: () => void
  onCreate: SaveViewHandler
  availableFields: string[]
  /** When provided, the dialog operates in edit mode with pre-populated fields. */
  editingView?: ViewDefinition | null
}

interface CreateViewDialogFormProps {
  availableFields: string[]
  initialName: string
  initialIcon: string
  initialColor: string | null
  initialFilters: FilterGroup
  isEditing: boolean
  onClose: () => void
  onCreate: SaveViewHandler
}

function CreateViewDialogForm({
  availableFields,
  initialName,
  initialIcon,
  initialColor,
  initialFilters,
  isEditing,
  onClose,
  onCreate,
}: CreateViewDialogFormProps) {
  const [name, setName] = useState(initialName)
  const [icon, setIcon] = useState(initialIcon)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [filters, setFilters] = useState<FilterGroup>(initialFilters)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => window.clearTimeout(timeoutId)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSaving) return
    const trimmed = name.trim()
    if (!trimmed) return
    const definition: ViewDefinition = {
      name: trimmed,
      icon: icon || null,
      color: initialColor,
      sort: null,
      filters,
    }
    setSaveError(null)
    setIsSaving(true)

    let shouldClose = false
    try {
      const result = await onCreate(definition)
      if (result === false) {
        setSaveError('Could not save view.')
      } else {
        shouldClose = true
      }
    } catch {
      setSaveError('Could not save view.')
    }

    setIsSaving(false)
    if (shouldClose) onClose()
  }

  const handleSelectEmoji = useCallback((emoji: string) => {
    setIcon(emoji)
    setShowEmojiPicker(false)
  }, [])

  const handleCloseEmojiPicker = useCallback(() => {
    setShowEmojiPicker(false)
  }, [])

  const isCreateDisabled = !name.trim()

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex gap-2">
        <div className="w-16 space-y-1.5 relative">
          <label className="text-xs font-medium text-muted-foreground">Icon</label>
          <Button
            type="button"
            variant="outline"
            className="flex h-9 w-full p-0 text-xl hover:bg-accent"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            title="Pick icon"
          >
            {icon || <span className="text-sm text-muted-foreground">📋</span>}
          </Button>
          {showEmojiPicker && (
            <EmojiPicker onSelect={handleSelectEmoji} onClose={handleCloseEmojiPicker} />
          )}
        </div>
        <div className="flex-1 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Name</label>
          <Input
            ref={inputRef}
            placeholder="e.g. Active Projects, Reading List..."
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (saveError) setSaveError(null)
            }}
          />
        </div>
      </div>
      {saveError && (
        <p role="alert" className="text-xs text-destructive">{saveError}</p>
      )}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        <label className="text-xs font-medium text-muted-foreground">Filters</label>
        <FilterBuilder
          group={filters}
          onChange={setFilters}
          availableFields={availableFields}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>Cancel</Button>
        <Button type="submit" disabled={isCreateDisabled || isSaving}>{isEditing ? 'Save' : 'Create'}</Button>
      </DialogFooter>
    </form>
  )
}

function getInitialViewFormValues(
  editingView: ViewDefinition | null | undefined,
  availableFields: string[],
): InitialViewFormValues {
  return {
    name: editingView?.name ?? '',
    icon: editingView?.icon ?? '',
    color: editingView?.color ?? null,
    filters: editingView?.filters ?? { all: [{ field: availableFields[0] ?? 'type', op: 'equals', value: '' }] },
  }
}

function getDialogDescription(isEditing: boolean) {
  return isEditing
    ? 'Update the name, icon, and filters for this saved view.'
    : 'Create a saved view by choosing a name, icon, and filter rules.'
}

export function CreateViewDialog({ open, onClose, onCreate, availableFields, editingView }: CreateViewDialogProps) {
  const isEditing = !!editingView
  const initialValues = getInitialViewFormValues(editingView, availableFields)
  const formKey = editingView ? `edit:${editingView.name}` : `create:${availableFields[0] ?? 'type'}`

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent showCloseButton={false} className="flex max-h-[80vh] flex-col sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit View' : 'Create View'}</DialogTitle>
          <DialogDescription className="sr-only">
            {getDialogDescription(isEditing)}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <CreateViewDialogForm
            key={formKey}
            availableFields={availableFields}
            initialName={initialValues.name}
            initialIcon={initialValues.icon ?? ''}
            initialColor={initialValues.color}
            initialFilters={initialValues.filters}
            isEditing={isEditing}
            onClose={onClose}
            onCreate={onCreate}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
