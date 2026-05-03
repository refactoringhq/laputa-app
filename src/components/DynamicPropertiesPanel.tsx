import { Plus } from '@phosphor-icons/react'
import { useMemo, useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { VaultEntry } from '../types'
import type { FrontmatterValue } from './Inspector'
import type { ParsedFrontmatter } from '../utils/frontmatter'
import { usePropertyPanelState } from '../hooks/usePropertyPanelState'
import { getEffectiveDisplayMode, detectPropertyType, DISPLAY_MODE_ICONS } from '../utils/propertyTypes'
import { SmartPropertyValueCell, DisplayModeSelector } from './PropertyValueCells'
import { TypeSelector } from './TypeSelector'
import { AddPropertyForm } from './AddPropertyForm'
import type { PropertyDisplayMode } from '../utils/propertyTypes'
import { FOCUS_NOTE_ICON_PROPERTY_EVENT } from './noteIconPropertyEvents'
import {
  PROPERTY_PANEL_GRID_STYLE,
  PROPERTY_PANEL_INTERACTIVE_ROW_CLASS_NAME,
  PROPERTY_PANEL_LABEL_CLASS_NAME,
  PROPERTY_PANEL_LABEL_ICON_SLOT_CLASS_NAME,
  PROPERTY_PANEL_PLACEHOLDER_LABEL_CLASS_NAME,
  PROPERTY_PANEL_PLACEHOLDER_VALUE_CLASS_NAME,
  PROPERTY_PANEL_ROW_STYLE,
} from './propertyPanelLayout'
import { humanizePropertyKey } from '../utils/propertyLabels'
import { translate, type AppLocale } from '../lib/i18n'
import { canonicalSystemMetadataKey, hasSystemMetadataKey } from '../utils/systemMetadata'

// eslint-disable-next-line react-refresh/only-export-components -- utility co-located with component
export function containsWikilinks(value: FrontmatterValue): boolean {
  if (typeof value === 'string') return /^\[\[.*\]\]$/.test(value)
  if (Array.isArray(value)) return value.some(v => typeof v === 'string' && /^\[\[.*\]\]$/.test(v))
  return false
}

const PROPERTY_ROW_CLASS_NAME = 'group/prop grid min-h-7 min-w-0 grid-cols-2 items-center gap-2 rounded px-1.5 outline-none transition-colors hover:bg-muted focus:bg-muted focus:ring-1 focus:ring-primary'

function PropertyRow({ propKey, value, editingKey, displayMode, autoMode, vaultStatuses, vaultTags, locale, onStartEdit, onSave, onSaveList, onUpdate, onDelete, onDisplayModeChange }: {
  propKey: string; value: FrontmatterValue; editingKey: string | null
  displayMode: PropertyDisplayMode; autoMode: PropertyDisplayMode
  vaultStatuses: string[]; vaultTags: string[]
  onStartEdit: (key: string | null) => void; onSave: (key: string, value: string) => void
  onSaveList: (key: string, items: string[]) => void
  onUpdate?: (key: string, value: FrontmatterValue) => void; onDelete?: (key: string) => void
  onDisplayModeChange: (key: string, mode: PropertyDisplayMode | null) => void
  locale: AppLocale
}) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) {
      return
    }
    if (e.key === 'Enter' && editingKey !== propKey) {
      e.preventDefault()
      onStartEdit(propKey)
    }
  }

  return (
    <div className={PROPERTY_ROW_CLASS_NAME} style={PROPERTY_PANEL_ROW_STYLE} tabIndex={0} onKeyDown={handleKeyDown} data-testid="editable-property">
      <span className={PROPERTY_PANEL_LABEL_CLASS_NAME}>
        <DisplayModeSelector propKey={propKey} currentMode={displayMode} autoMode={autoMode} onSelect={onDisplayModeChange} />
        <span className="min-w-0 flex-1 truncate">{humanizePropertyKey(propKey)}</span>
        {onDelete && (
          <button className="border-none bg-transparent p-0 text-sm leading-none text-muted-foreground opacity-0 transition-all hover:text-destructive group-hover/prop:opacity-100" onClick={() => onDelete(propKey)} title={translate(locale, 'inspector.properties.deleteProperty')}>&times;</button>
        )}
      </span>
      <div className="min-w-0">
        <SmartPropertyValueCell propKey={propKey} value={value} displayMode={displayMode} isEditing={editingKey === propKey} vaultStatuses={vaultStatuses} vaultTags={vaultTags} onStartEdit={onStartEdit} onSave={onSave} onSaveList={onSaveList} onUpdate={onUpdate} />
      </div>
    </div>
  )
}

function AddPropertyButton({ locale, onClick, disabled }: { locale: AppLocale; onClick: () => void; disabled: boolean }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={PROPERTY_PANEL_INTERACTIVE_ROW_CLASS_NAME}
      style={PROPERTY_PANEL_ROW_STYLE}
      onClick={onClick}
      disabled={disabled}
      data-testid="add-property-row"
    >
      <span className={PROPERTY_PANEL_PLACEHOLDER_LABEL_CLASS_NAME}>
        <span
          className={PROPERTY_PANEL_LABEL_ICON_SLOT_CLASS_NAME}
          data-testid="add-property-icon-slot"
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </span>
        <span className="min-w-0 truncate">{translate(locale, 'inspector.properties.addProperty')}</span>
      </span>
      <span aria-hidden="true" className={PROPERTY_PANEL_PLACEHOLDER_VALUE_CLASS_NAME} />
    </Button>
  )
}

const SUGGESTED_PROPERTIES = [
  { key: 'Status', label: 'Status' },
  { key: 'Date', label: 'Date' },
  { key: 'URL', label: 'URL' },
  { key: 'icon', label: 'Icon' },
] as const

const SUGGESTED_PROPERTY_MODES: Record<string, PropertyDisplayMode> = {
  Status: 'status',
  Date: 'date',
  URL: 'url',
  icon: 'text',
}

function getSuggestedDisplayMode(key: string): PropertyDisplayMode {
  return SUGGESTED_PROPERTY_MODES[key] ?? 'text'
}

function resolveMissingTypeName(entryIsA: string | null | undefined, availableTypes: string[]): string | null {
  const trimmed = entryIsA?.trim()
  if (!trimmed) return null
  return availableTypes.includes(trimmed) ? null : trimmed
}

function SuggestedPropertySlot({ label, displayMode, onAdd }: {
  label: string
  displayMode: PropertyDisplayMode
  onAdd: () => void
}) {
  const SuggestedIcon = DISPLAY_MODE_ICONS[displayMode]

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={PROPERTY_PANEL_INTERACTIVE_ROW_CLASS_NAME}
      style={PROPERTY_PANEL_ROW_STYLE}
      onClick={onAdd}
      data-testid="suggested-property"
    >
      <span className={PROPERTY_PANEL_PLACEHOLDER_LABEL_CLASS_NAME}>
        <span
          className={PROPERTY_PANEL_LABEL_ICON_SLOT_CLASS_NAME}
          data-testid="suggested-property-icon-slot"
        >
          <SuggestedIcon
            className="size-3.5 shrink-0 text-muted-foreground/40"
            data-testid={`suggested-property-icon-${displayMode}`}
          />
        </span>
        <span className="min-w-0 truncate">{label}</span>
      </span>
      <span className={PROPERTY_PANEL_PLACEHOLDER_VALUE_CLASS_NAME}>{'\u2014'}</span>
    </Button>
  )
}

function getExistingPropertyKeys(propertyEntries: [string, FrontmatterValue][], frontmatter: ParsedFrontmatter): Set<string> {
  const keys = new Set(propertyEntries.map(([key]) => key.toLowerCase()))
  for (const key of Object.keys(frontmatter)) keys.add(key.toLowerCase())
  if (hasSystemMetadataKey(keys, '_icon')) keys.add('icon')
  return keys
}

function getMissingSuggestedProperties(canAddProperty: boolean, existingKeys: Set<string>, pendingSuggestedKey: string | null) {
  if (!canAddProperty) return []

  return SUGGESTED_PROPERTIES.filter(
    ({ key }) => !existingKeys.has(key.toLowerCase()) && key !== pendingSuggestedKey,
  )
}

function useFocusNoteIconProperty({
  onAddProperty,
  setEditingKey,
  setPendingSuggestedKey,
}: {
  onAddProperty?: (key: string, value: FrontmatterValue) => void
  setEditingKey: (key: string | null) => void
  setPendingSuggestedKey: (key: string | null) => void
}) {
  useEffect(() => {
    const handleFocusNoteIcon = () => {
      if (!onAddProperty) return
      setPendingSuggestedKey('icon')
      setEditingKey('icon')
    }

    window.addEventListener(FOCUS_NOTE_ICON_PROPERTY_EVENT, handleFocusNoteIcon)
    return () => window.removeEventListener(FOCUS_NOTE_ICON_PROPERTY_EVENT, handleFocusNoteIcon)
  }, [onAddProperty, setEditingKey, setPendingSuggestedKey])
}

function useSuggestedPropertyActions({
  onAddProperty,
  setEditingKey,
  setPendingSuggestedKey,
}: {
  onAddProperty?: (key: string, value: FrontmatterValue) => void
  setEditingKey: (key: string | null) => void
  setPendingSuggestedKey: (key: string | null) => void
}) {
  const handleSuggestedAdd = useCallback((key: string) => {
    if (!onAddProperty) return
    setPendingSuggestedKey(key)
    setEditingKey(key)
  }, [onAddProperty, setEditingKey, setPendingSuggestedKey])

  const handlePendingSuggestedEdit = useCallback((key: string | null) => {
    setEditingKey(key)
    if (key === null) setPendingSuggestedKey(null)
  }, [setEditingKey, setPendingSuggestedKey])

  const handleSaveSuggestedValue = useCallback((key: string, newValue: string) => {
    setEditingKey(null)
    setPendingSuggestedKey(null)
    if (!onAddProperty) {
      return
    }
    const trimmed = newValue.trim()
    if (!trimmed) {
      return
    }
    onAddProperty(key === 'icon' ? canonicalSystemMetadataKey(key) : key, trimmed)
  }, [onAddProperty, setEditingKey, setPendingSuggestedKey])

  return {
    handlePendingSuggestedEdit,
    handleSaveSuggestedValue,
    handleSuggestedAdd,
  }
}

export function DynamicPropertiesPanel({
  entry, frontmatter, entries,
  onUpdateProperty, onDeleteProperty, onAddProperty, onNavigate, onCreateMissingType,
  locale = 'en',
}: {
  entry: VaultEntry
  content?: string | null
  frontmatter: ParsedFrontmatter
  entries?: VaultEntry[]
  onUpdateProperty?: (key: string, value: FrontmatterValue) => void
  onDeleteProperty?: (key: string) => void
  onAddProperty?: (key: string, value: FrontmatterValue) => void
  onNavigate?: (target: string) => void
  onCreateMissingType?: (typeName: string) => boolean | void | Promise<boolean | void>
  locale?: AppLocale
}) {
  const {
    editingKey, setEditingKey, showAddDialog, setShowAddDialog, displayOverrides,
    availableTypes, customColorKey, typeColorKeys, typeIconKeys, vaultStatuses, vaultTagsByKey, propertyEntries,
    handleSaveValue, handleSaveList, handleAdd, handleDisplayModeChange,
  } = usePropertyPanelState({ entries, entryIsA: entry.isA, frontmatter, onUpdateProperty, onDeleteProperty, onAddProperty })
  const [pendingSuggestedKey, setPendingSuggestedKey] = useState<string | null>(null)
  const missingTypeName = useMemo(() => resolveMissingTypeName(entry.isA, availableTypes), [entry.isA, availableTypes])

  const existingKeys = useMemo(() => getExistingPropertyKeys(propertyEntries, frontmatter), [propertyEntries, frontmatter])
  const missingSuggested = useMemo(
    () => getMissingSuggestedProperties(Boolean(onAddProperty), existingKeys, pendingSuggestedKey),
    [existingKeys, onAddProperty, pendingSuggestedKey],
  )
  const {
    handlePendingSuggestedEdit,
    handleSaveSuggestedValue,
    handleSuggestedAdd,
  } = useSuggestedPropertyActions({
    onAddProperty,
    setEditingKey,
    setPendingSuggestedKey,
  })

  useFocusNoteIconProperty({ onAddProperty, setEditingKey, setPendingSuggestedKey })

  return (
    <div className="flex flex-col gap-3">
      <div className="grid min-w-0 gap-x-2 gap-y-1.5" style={PROPERTY_PANEL_GRID_STYLE}>
        <TypeSelector
          isA={entry.isA}
          customColorKey={customColorKey}
          availableTypes={availableTypes}
          typeColorKeys={typeColorKeys}
          typeIconKeys={typeIconKeys}
          onUpdateProperty={onUpdateProperty}
          onNavigate={onNavigate}
          missingTypeName={missingTypeName}
          onCreateMissingType={onCreateMissingType}
          locale={locale}
        />
        {propertyEntries.map(([key, value]) => (
          <PropertyRow
            key={key} propKey={key} value={value}
            editingKey={editingKey} displayMode={getEffectiveDisplayMode(key, value, displayOverrides)} autoMode={detectPropertyType(key, value)}
            vaultStatuses={vaultStatuses}
            vaultTags={vaultTagsByKey[key] ?? []}
            onStartEdit={setEditingKey} onSave={handleSaveValue}
            onSaveList={handleSaveList} onUpdate={onUpdateProperty}
            onDelete={onDeleteProperty}
            onDisplayModeChange={handleDisplayModeChange}
            locale={locale}
          />
        ))}
        {pendingSuggestedKey && editingKey === pendingSuggestedKey && (
          <PropertyRow
            key={`pending:${pendingSuggestedKey}`}
            propKey={pendingSuggestedKey}
            value=""
            editingKey={editingKey}
            displayMode={getSuggestedDisplayMode(pendingSuggestedKey)}
            autoMode={getSuggestedDisplayMode(pendingSuggestedKey)}
            vaultStatuses={vaultStatuses}
            vaultTags={vaultTagsByKey[pendingSuggestedKey] ?? []}
            onStartEdit={handlePendingSuggestedEdit}
            onSave={handleSaveSuggestedValue}
            onSaveList={handleSaveList}
            onUpdate={undefined}
            onDelete={undefined}
            onDisplayModeChange={handleDisplayModeChange}
            locale={locale}
          />
        )}
        {missingSuggested.map(({ key, label }) => (
          <SuggestedPropertySlot
            key={key}
            label={label}
            displayMode={getSuggestedDisplayMode(key)}
            onAdd={() => handleSuggestedAdd(key)}
          />
        ))}
        {!showAddDialog && (
          <AddPropertyButton
            locale={locale}
            onClick={() => setShowAddDialog(true)}
            disabled={!onAddProperty}
          />
        )}
      </div>
      {showAddDialog && (
        <AddPropertyForm
          onAdd={handleAdd}
          onCancel={() => setShowAddDialog(false)}
          vaultStatuses={vaultStatuses}
          locale={locale}
        />
      )}
    </div>
  )
}
