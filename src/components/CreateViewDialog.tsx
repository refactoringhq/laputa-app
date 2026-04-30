import { useState, useRef, useEffect } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FilterBuilder } from './FilterBuilder'
import type { FilterGroup, ViewDefinition } from '../types'
import { TypeCustomizePopover } from './TypeCustomizePopover'
import { translate, type AppLocale, type TranslationKey } from '../lib/i18n'

type SaveViewResult = boolean | void
type SaveViewHandler = (definition: ViewDefinition) => SaveViewResult | Promise<SaveViewResult>
type InitialViewFormValues = Pick<ViewDefinition, 'name' | 'icon' | 'color' | 'filters'>

interface CreateViewDialogProps {
  open: boolean
  onClose: () => void
  onCreate: SaveViewHandler
  availableFields: string[]
  locale?: AppLocale
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
  locale: AppLocale
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
  locale,
  onClose,
  onCreate,
}: CreateViewDialogFormProps) {
  const [name, setName] = useState(initialName)
  const [icon, setIcon] = useState(initialIcon)
  const [color, setColor] = useState<string | null>(initialColor)
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
      color,
      sort: null,
      filters,
    }
    setSaveError(null)
    setIsSaving(true)

    let shouldClose = false
    try {
      const result = await onCreate(definition)
      if (result === false) {
        setSaveError(translate(locale, 'viewDialog.saveError'))
      } else {
        shouldClose = true
      }
    } catch {
      setSaveError(translate(locale, 'viewDialog.saveError'))
    }

    setIsSaving(false)
    if (shouldClose) onClose()
  }

  const isCreateDisabled = !name.trim()

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">{translate(locale, 'viewDialog.nameLabel')}</label>
        <Input
          ref={inputRef}
          placeholder={translate(locale, 'viewDialog.namePlaceholder')}
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            if (saveError) setSaveError(null)
          }}
        />
      </div>
      <TypeCustomizePopover
        currentIcon={icon || null}
        currentColor={color}
        currentTemplate={null}
        onChangeIcon={setIcon}
        onChangeColor={setColor}
        onChangeTemplate={() => {}}
        onClose={() => {}}
        showTemplate={false}
        showDone={false}
        surface="inline"
        locale={locale}
      />
      <div className="sr-only" aria-live="polite">
        {icon ? translate(locale, 'viewDialog.selectedIcon', { icon }) : ''}
        {color ? translate(locale, 'viewDialog.selectedColor', { color }) : ''}
      </div>
      {saveError && (
        <p role="alert" className="text-xs text-destructive">{saveError}</p>
      )}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        <label className="text-xs font-medium text-muted-foreground">{translate(locale, 'viewDialog.filtersLabel')}</label>
        <FilterBuilder
          group={filters}
          onChange={setFilters}
          availableFields={availableFields}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
          {translate(locale, 'common.cancel')}
        </Button>
        <Button type="submit" disabled={isCreateDisabled || isSaving}>
          {translate(locale, isEditing ? 'common.save' : 'common.create')}
        </Button>
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

function getDialogDescription(isEditing: boolean): TranslationKey {
  return isEditing
    ? 'viewDialog.description.edit'
    : 'viewDialog.description.create'
}

export function CreateViewDialog({ open, onClose, onCreate, availableFields, locale = 'en', editingView }: CreateViewDialogProps) {
  const isEditing = !!editingView
  const initialValues = getInitialViewFormValues(editingView, availableFields)
  const formKey = editingView ? `edit:${editingView.name}` : `create:${availableFields[0] ?? 'type'}`

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent showCloseButton={false} className="flex max-h-[80vh] flex-col sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{translate(locale, isEditing ? 'viewDialog.title.edit' : 'viewDialog.title.create')}</DialogTitle>
          <DialogDescription className="sr-only">
            {translate(locale, getDialogDescription(isEditing))}
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
            locale={locale}
            onClose={onClose}
            onCreate={onCreate}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
