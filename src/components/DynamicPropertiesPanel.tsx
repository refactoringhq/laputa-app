import { Plus } from '@phosphor-icons/react'
import { useMemo, useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { VaultEntry, WorkspaceIdentity } from '../types'
import type { FrontmatterValue } from './Inspector'
import type { ParsedFrontmatter } from '../utils/frontmatter'
import { usePropertyPanelState } from '../hooks/usePropertyPanelState'
import { getEffectiveDisplayMode, detectPropertyType, DISPLAY_MODE_ICONS } from '../utils/propertyTypes'
import { SmartPropertyValueCell, DisplayModeSelector } from './PropertyValueCells'
import { TypeSelector } from './TypeSelector'
import { WorkspaceSelector } from './WorkspaceSelector'
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
        <SmartPropertyValueCell propKey={propKey} value={value} displayMode={displayMode} isEditing={editingKey === propKey} locale={locale} vaultStatuses={vaultStatuses} vaultTags={vaultTags} onStartEdit={onStartEdit} onSave={onSave} onSaveList={onSaveList} onUpdate={onUpdate} />
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
  return (Reflect.get(SUGGESTED_PROPERTY_MODES, key) as PropertyDisplayMode | undefined) ?? 'text'
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
  const SuggestedIcon = Reflect.get(DISPLAY_MODE_ICONS, displayMode) as typeof Plus

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

function TypeDerivedPropertySlot({
  propKey,
  editingKey,
  displayMode,
  autoMode,
  vaultStatuses,
  vaultTags,
  onStartEdit,
  onSave,
  onSaveList,
  onUpdate,
  onDisplayModeChange,
  locale,
}: {
  propKey: string
  editingKey: string | null
  displayMode: PropertyDisplayMode
  autoMode: PropertyDisplayMode
  vaultStatuses: string[]
  vaultTags: string[]
  onStartEdit: (key: string | null) => void
  onSave: (key: string, value: string) => void
  onSaveList: (key: string, items: string[]) => void
  onUpdate?: (key: string, value: FrontmatterValue) => void
  onDisplayModeChange: (key: string, mode: PropertyDisplayMode | null) => void
  locale: AppLocale
}) {
  if (editingKey === propKey) {
    return (
      <PropertyRow
        propKey={propKey}
        value=""
        editingKey={editingKey}
        displayMode={displayMode}
        autoMode={autoMode}
        vaultStatuses={vaultStatuses}
        vaultTags={vaultTags}
        onStartEdit={onStartEdit}
        onSave={onSave}
        onSaveList={onSaveList}
        onUpdate={onUpdate}
        onDisplayModeChange={onDisplayModeChange}
        locale={locale}
      />
    )
  }

  const PlaceholderIcon = Reflect.get(DISPLAY_MODE_ICONS, displayMode) as typeof Plus

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={PROPERTY_PANEL_INTERACTIVE_ROW_CLASS_NAME}
      style={PROPERTY_PANEL_ROW_STYLE}
      onClick={() => onStartEdit(propKey)}
      disabled={!onUpdate}
      data-testid="type-derived-property"
    >
      <span className={PROPERTY_PANEL_PLACEHOLDER_LABEL_CLASS_NAME}>
        <span
          className={PROPERTY_PANEL_LABEL_ICON_SLOT_CLASS_NAME}
          data-testid="type-derived-property-icon-slot"
        >
          <PlaceholderIcon
            className="size-3.5 shrink-0 text-muted-foreground/40"
            data-testid={`type-derived-property-icon-${displayMode}`}
          />
        </span>
        <span className="min-w-0 truncate text-muted-foreground/40">{humanizePropertyKey(propKey)}</span>
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

function PropertyEntryRows({
  source,
  entries,
  editingKey,
  displayOverrides,
  vaultStatuses,
  vaultTagsByKey,
  locale,
  onStartEdit,
  onSave,
  onSaveList,
  onUpdate,
  onDelete,
  onDisplayModeChange,
}: {
  source: 'frontmatter' | 'type-derived'
  entries: [string, FrontmatterValue][]
  editingKey: string | null
  displayOverrides: Record<string, PropertyDisplayMode>
  vaultStatuses: string[]
  vaultTagsByKey: Record<string, string[]>
  locale: AppLocale
  onStartEdit: (key: string | null) => void
  onSave: (key: string, value: string) => void
  onSaveList: (key: string, items: string[]) => void
  onUpdate?: (key: string, value: FrontmatterValue) => void
  onDelete?: (key: string) => void
  onDisplayModeChange: (key: string, mode: PropertyDisplayMode | null) => void
}) {
  return (
    <>
      {entries.map(([key, value]) => (
        source === 'type-derived' ? (
          <TypeDerivedPropertySlot
            key={`type-derived:${key}`}
            propKey={key}
            editingKey={editingKey}
            displayMode={getEffectiveDisplayMode(key, value, displayOverrides)}
            autoMode={detectPropertyType(key, value)}
            vaultStatuses={vaultStatuses}
            vaultTags={(Reflect.get(vaultTagsByKey, key) as string[] | undefined) ?? []}
            onStartEdit={onStartEdit}
            onSave={onSave}
            onSaveList={onSaveList}
            onUpdate={onUpdate}
            onDisplayModeChange={onDisplayModeChange}
            locale={locale}
          />
        ) : (
          <PropertyRow
            key={key} propKey={key} value={value}
            editingKey={editingKey} displayMode={getEffectiveDisplayMode(key, value, displayOverrides)} autoMode={detectPropertyType(key, value)}
            vaultStatuses={vaultStatuses}
            vaultTags={(Reflect.get(vaultTagsByKey, key) as string[] | undefined) ?? []}
            onStartEdit={onStartEdit} onSave={onSave}
            onSaveList={onSaveList} onUpdate={onUpdate}
            onDelete={onDelete}
            onDisplayModeChange={onDisplayModeChange}
            locale={locale}
          />
        )
      ))}
    </>
  )
}

function PendingSuggestedPropertyRow({
  pendingSuggestedKey,
  editingKey,
  vaultStatuses,
  vaultTagsByKey,
  locale,
  onStartEdit,
  onSave,
  onSaveList,
  onDisplayModeChange,
}: {
  pendingSuggestedKey: string | null
  editingKey: string | null
  vaultStatuses: string[]
  vaultTagsByKey: Record<string, string[]>
  locale: AppLocale
  onStartEdit: (key: string | null) => void
  onSave: (key: string, value: string) => void
  onSaveList: (key: string, items: string[]) => void
  onDisplayModeChange: (key: string, mode: PropertyDisplayMode | null) => void
}) {
  if (!pendingSuggestedKey || editingKey !== pendingSuggestedKey) {
    return null
  }

  return (
    <PropertyRow
      key={`pending:${pendingSuggestedKey}`}
      propKey={pendingSuggestedKey}
      value=""
      editingKey={editingKey}
      displayMode={getSuggestedDisplayMode(pendingSuggestedKey)}
      autoMode={getSuggestedDisplayMode(pendingSuggestedKey)}
      vaultStatuses={vaultStatuses}
      vaultTags={(Reflect.get(vaultTagsByKey, pendingSuggestedKey) as string[] | undefined) ?? []}
      onStartEdit={onStartEdit}
      onSave={onSave}
      onSaveList={onSaveList}
      onUpdate={undefined}
      onDelete={undefined}
      onDisplayModeChange={onDisplayModeChange}
      locale={locale}
    />
  )
}

function SuggestedPropertyRows({
  properties,
  onAdd,
}: {
  properties: Array<{ key: string; label: string }>
  onAdd: (key: string) => void
}) {
  return (
    <>
      {properties.map(({ key, label }) => (
        <SuggestedPropertySlot
          key={key}
          label={label}
          displayMode={getSuggestedDisplayMode(key)}
          onAdd={() => onAdd(key)}
        />
      ))}
    </>
  )
}

type PropertyPanelState = ReturnType<typeof usePropertyPanelState>

function MetadataSelectors({
  availableTypes,
  customColorKey,
  entry,
  locale,
  missingTypeName,
  onChangeWorkspace,
  onCreateMissingType,
  onNavigate,
  onUpdateProperty,
  typeColorKeys,
  typeIconKeys,
  workspaces,
}: {
  availableTypes: string[]
  customColorKey?: string | null
  entry: VaultEntry
  locale: AppLocale
  missingTypeName?: string | null
  onChangeWorkspace?: (workspace: WorkspaceIdentity) => void | Promise<void>
  onCreateMissingType?: (typeName: string) => boolean | void | Promise<boolean | void>
  onNavigate?: (target: string) => void
  onUpdateProperty?: (key: string, value: FrontmatterValue) => void
  typeColorKeys: Record<string, string | null>
  typeIconKeys: Record<string, string | null>
  workspaces?: WorkspaceIdentity[]
}) {
  return (
    <>
      <WorkspaceSelector
        currentWorkspace={entry.workspace}
        workspaces={workspaces ?? []}
        onChangeWorkspace={onChangeWorkspace}
        locale={locale}
      />
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
    </>
  )
}

function DynamicPropertiesPanelContent({
  entry,
  propertyState,
  pendingSuggestedKey,
  missingSuggested,
  missingTypeName,
  locale,
  workspaces,
  onUpdateProperty,
  onDeleteProperty,
  onAddProperty,
  onNavigate,
  onCreateMissingType,
  onChangeWorkspace,
  onStartPendingSuggestedEdit,
  onSaveSuggestedValue,
  onAddSuggestedProperty,
}: {
  entry: VaultEntry
  propertyState: PropertyPanelState
  pendingSuggestedKey: string | null
  missingSuggested: Array<{ key: string; label: string }>
  missingTypeName: string | null
  locale: AppLocale
  workspaces?: WorkspaceIdentity[]
  onUpdateProperty?: (key: string, value: FrontmatterValue) => void
  onDeleteProperty?: (key: string) => void
  onAddProperty?: (key: string, value: FrontmatterValue) => void
  onNavigate?: (target: string) => void
  onCreateMissingType?: (typeName: string) => boolean | void | Promise<boolean | void>
  onChangeWorkspace?: (workspace: WorkspaceIdentity) => void | Promise<void>
  onStartPendingSuggestedEdit: (key: string | null) => void
  onSaveSuggestedValue: (key: string, newValue: string) => void
  onAddSuggestedProperty: (key: string) => void
}) {
  const {
    editingKey, setEditingKey, showAddDialog, setShowAddDialog, displayOverrides,
    availableTypes, customColorKey, typeColorKeys, typeIconKeys, vaultStatuses, vaultTagsByKey, propertyEntries,
    typeDerivedPropertyEntries, handleSaveValue, handleSaveTypeDerivedValue, handleSaveList, handleAdd, handleDisplayModeChange,
  } = propertyState

  return (
    <div className="flex flex-col gap-3">
      <div className="grid min-w-0 gap-x-2 gap-y-1.5" style={PROPERTY_PANEL_GRID_STYLE}>
        <MetadataSelectors
          availableTypes={availableTypes}
          customColorKey={customColorKey}
          entry={entry}
          locale={locale}
          missingTypeName={missingTypeName}
          onChangeWorkspace={onChangeWorkspace}
          onCreateMissingType={onCreateMissingType}
          onNavigate={onNavigate}
          onUpdateProperty={onUpdateProperty}
          typeColorKeys={typeColorKeys}
          typeIconKeys={typeIconKeys}
          workspaces={workspaces}
        />
        <PropertyEntryRows
          source="frontmatter"
          entries={propertyEntries}
          editingKey={editingKey}
          displayOverrides={displayOverrides}
          vaultStatuses={vaultStatuses}
          vaultTagsByKey={vaultTagsByKey}
          locale={locale}
          onStartEdit={setEditingKey}
          onSave={handleSaveValue}
          onSaveList={handleSaveList}
          onUpdate={onUpdateProperty}
          onDelete={onDeleteProperty}
          onDisplayModeChange={handleDisplayModeChange}
        />
        <PropertyEntryRows
          source="type-derived"
          entries={typeDerivedPropertyEntries}
          editingKey={editingKey}
          displayOverrides={displayOverrides}
          vaultStatuses={vaultStatuses}
          vaultTagsByKey={vaultTagsByKey}
          locale={locale}
          onStartEdit={setEditingKey}
          onSave={handleSaveTypeDerivedValue}
          onSaveList={handleSaveList}
          onUpdate={onUpdateProperty}
          onDisplayModeChange={handleDisplayModeChange}
        />
        <PendingSuggestedPropertyRow
          pendingSuggestedKey={pendingSuggestedKey}
          editingKey={editingKey}
          vaultStatuses={vaultStatuses}
          vaultTagsByKey={vaultTagsByKey}
          locale={locale}
          onStartEdit={onStartPendingSuggestedEdit}
          onSave={onSaveSuggestedValue}
          onSaveList={handleSaveList}
          onDisplayModeChange={handleDisplayModeChange}
        />
        <SuggestedPropertyRows properties={missingSuggested} onAdd={onAddSuggestedProperty} />
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

interface DynamicPropertiesPanelProps {
  entry: VaultEntry
  content?: string | null
  frontmatter: ParsedFrontmatter
  entries?: VaultEntry[]
  workspaces?: WorkspaceIdentity[]
  onUpdateProperty?: (key: string, value: FrontmatterValue) => void
  onDeleteProperty?: (key: string) => void
  onAddProperty?: (key: string, value: FrontmatterValue) => void
  onNavigate?: (target: string) => void
  onCreateMissingType?: (typeName: string) => boolean | void | Promise<boolean | void>
  onChangeWorkspace?: (workspace: WorkspaceIdentity) => void | Promise<void>
  locale?: AppLocale
}

export function DynamicPropertiesPanel({
  entry, frontmatter, entries,
  onUpdateProperty, onDeleteProperty, onAddProperty, onNavigate, onCreateMissingType,
  onChangeWorkspace, workspaces,
  locale = 'en',
}: DynamicPropertiesPanelProps) {
  const propertyState = usePropertyPanelState({ entries, entryIsA: entry.isA, frontmatter, onUpdateProperty, onDeleteProperty, onAddProperty })
  const [pendingSuggestedKey, setPendingSuggestedKey] = useState<string | null>(null)
  const missingTypeName = useMemo(() => resolveMissingTypeName(entry.isA, propertyState.availableTypes), [entry.isA, propertyState.availableTypes])

  const existingKeys = useMemo(
    () => getExistingPropertyKeys([...propertyState.propertyEntries, ...propertyState.typeDerivedPropertyEntries], frontmatter),
    [frontmatter, propertyState.propertyEntries, propertyState.typeDerivedPropertyEntries],
  )
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
    setEditingKey: propertyState.setEditingKey,
    setPendingSuggestedKey,
  })

  useFocusNoteIconProperty({ onAddProperty, setEditingKey: propertyState.setEditingKey, setPendingSuggestedKey })

  return (
    <DynamicPropertiesPanelContent
      entry={entry}
      propertyState={propertyState}
      pendingSuggestedKey={pendingSuggestedKey}
      missingSuggested={missingSuggested}
      missingTypeName={missingTypeName}
      locale={locale}
      workspaces={workspaces}
      onUpdateProperty={onUpdateProperty}
      onDeleteProperty={onDeleteProperty}
      onAddProperty={onAddProperty}
      onNavigate={onNavigate}
      onCreateMissingType={onCreateMissingType}
      onChangeWorkspace={onChangeWorkspace}
      onStartPendingSuggestedEdit={handlePendingSuggestedEdit}
      onSaveSuggestedValue={handleSaveSuggestedValue}
      onAddSuggestedProperty={handleSuggestedAdd}
    />
  )
}
