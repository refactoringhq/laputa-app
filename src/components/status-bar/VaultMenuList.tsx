import { Check, ArrowSquareOut, Warning as AlertTriangle, X } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ActionTooltip } from '@/components/ui/action-tooltip'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { translate, type AppLocale } from '../../lib/i18n'
import { trackEvent } from '../../lib/telemetry'
import { openVaultInNewWindow } from '../../utils/openVaultWindow'
import { reorderVaultPath, vaultPathList } from '../../utils/vaultOrdering'
import { workspaceAliasFromOption, workspaceIdentityFromVault } from '../../utils/workspaces'
import { WorkspaceInitialsBadge } from '../WorkspaceInitialsBadge'
import type { VaultOption } from './types'

interface VaultMenuItemProps {
  vault: VaultOption
  isActive: boolean
  canRemove: boolean
  disableMountToggle: boolean
  locale: AppLocale
  multiWorkspaceEnabled: boolean
  onSelect: () => void
  onMountedChange?: (path: string, mounted: boolean) => void
  onRequestRemove?: () => void
}

export interface VaultMenuListProps {
  canRemove: boolean
  defaultPath: string
  disableMountToggleForPath: (path: string) => boolean
  locale: AppLocale
  multiWorkspaceEnabled: boolean
  onMountedChange: (path: string, mounted: boolean) => void
  onRemoveVault?: (path: string) => void
  onReorderVaults?: (orderedPaths: string[]) => void
  onSelectVault: (path: string) => void
  setVaultPendingRemoval: (vault: VaultOption) => void
  vaults: VaultOption[]
}

function VaultMenuIcon(props: { isActive: boolean; unavailable: boolean }) {
  if (props.isActive) return <Check size={14} />
  if (props.unavailable) {
    return <AlertTriangle size={14} style={{ color: 'var(--muted-foreground)' }} />
  }
  return <span className="w-3.5" />
}

function workspaceMountLabel(locale: AppLocale, vault: VaultOption): string {
  return translate(locale, 'status.vault.includeWorkspace', { label: vault.label })
}

function WorkspaceMountCheckbox(props: {
  checked: boolean
  disabled: boolean
  locale: AppLocale
  onMountedChange?: (path: string, mounted: boolean) => void
  vault: VaultOption
}) {
  const { checked, disabled, locale, onMountedChange, vault } = props
  return (
    <Checkbox
      checked={checked}
      disabled={disabled || !onMountedChange}
      aria-label={workspaceMountLabel(locale, vault)}
      className="ml-1"
      onCheckedChange={(nextChecked) => {
        if (typeof nextChecked !== 'boolean') return
        onMountedChange?.(vault.path, nextChecked)
        trackEvent('workspace_mount_changed', {
          workspace_alias: workspaceAliasFromOption(vault),
          mounted: nextChecked ? 1 : 0,
        })
      }}
    />
  )
}

function vaultMenuItemClassName(isActive: boolean): string {
  return [
    'h-auto min-w-0 flex-1 justify-start rounded-sm px-2 py-1.5 text-sm font-normal',
    isActive
      ? 'text-foreground hover:bg-[var(--hover)] hover:text-foreground'
      : 'text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground',
  ].join(' ')
}

function VaultMenuItemButton(props: Pick<
  VaultMenuItemProps,
  'vault' | 'isActive' | 'locale' | 'multiWorkspaceEnabled' | 'onSelect'
>) {
  const { vault, isActive, locale, multiWorkspaceEnabled, onSelect } = props
  const unavailable = vault.available === false
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      disabled={unavailable}
      onClick={onSelect}
      aria-current={isActive ? 'true' : undefined}
      title={unavailable ? translate(locale, 'status.vault.notFound', { path: vault.path }) : vault.path}
      data-testid={`vault-menu-item-label-${vault.label}`}
      className={vaultMenuItemClassName(isActive)}
      style={{ background: 'transparent', opacity: unavailable ? 0.45 : 1 }}
    >
      <span className="flex min-w-0 items-center gap-2">
        {!multiWorkspaceEnabled && <VaultMenuIcon isActive={isActive} unavailable={unavailable} />}
        <span className="truncate">{vault.label}</span>
      </span>
    </Button>
  )
}

function DefaultVaultLabel(props: { isDefault: boolean; locale: AppLocale }) {
  if (!props.isDefault) return null

  return (
    <span className="text-xs font-medium text-muted-foreground" data-testid="vault-menu-default-label">
      {translate(props.locale, 'workspace.manager.default')}
    </span>
  )
}

function VaultWorkspaceInitialsBadge(props: { vault: VaultOption }) {
  return (
    <WorkspaceInitialsBadge
      workspace={workspaceIdentityFromVault(props.vault)}
      testId={`vault-menu-workspace-badge-${props.vault.label}`}
    />
  )
}

const HOVER_ACTION_CLASS = 'h-7 w-7 shrink-0 rounded-sm text-muted-foreground opacity-0 pointer-events-none transition-opacity hover:bg-[var(--hover)] hover:text-foreground focus-visible:opacity-100 focus-visible:pointer-events-auto group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto'

function VaultOpenWindowButton(props: { locale: AppLocale; vault: VaultOption }) {
  const { locale, vault } = props
  if (vault.available === false) return null

  const label = translate(locale, 'status.vault.openInNewWindow', { label: vault.label })
  return (
    <ActionTooltip copy={{ label }} side="top">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={(event) => {
          event.stopPropagation()
          void openVaultInNewWindow(vault).catch((error: unknown) => {
            console.warn('Failed to open vault in a separate window:', error)
          })
        }}
        aria-label={label}
        data-testid={`vault-menu-open-window-${vault.label}`}
        className={HOVER_ACTION_CLASS}
      >
        <ArrowSquareOut size={14} />
      </Button>
    </ActionTooltip>
  )
}

function VaultMenuRemoveButton(props: Pick<
  VaultMenuItemProps,
  'locale' | 'onRequestRemove' | 'vault'
>) {
  const { locale, onRequestRemove, vault } = props
  if (!onRequestRemove) return null

  const removeLabel = translate(locale, 'status.vault.remove', { label: vault.label })
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={(event) => {
        event.stopPropagation()
        onRequestRemove()
      }}
      title={removeLabel}
      aria-label={removeLabel}
      data-testid={`vault-menu-remove-${vault.label}`}
      className={HOVER_ACTION_CLASS}
    >
      <X size={12} />
    </Button>
  )
}

function VaultMenuItem(props: VaultMenuItemProps) {
  const {
    vault,
    isActive,
    canRemove,
    disableMountToggle,
    locale,
    multiWorkspaceEnabled,
    onSelect,
    onMountedChange,
    onRequestRemove,
  } = props
  const unavailable = vault.available === false
  const itemRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const item = itemRef.current
    if (!item || unavailable) return

    const handleItemClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('button,input')) return
      onSelect()
    }

    item.addEventListener('click', handleItemClick)
    return () => { item.removeEventListener('click', handleItemClick); }
  }, [onSelect, unavailable])

  return (
    <div
      ref={itemRef}
      className="group relative flex w-full items-center rounded-sm hover:bg-[var(--hover)]"
      data-testid={`vault-menu-item-${vault.label}`}
    >
      {multiWorkspaceEnabled && (
        <WorkspaceMountCheckbox
          checked={vault.mounted !== false}
          disabled={unavailable || disableMountToggle}
          locale={locale}
          onMountedChange={onMountedChange}
          vault={vault}
        />
      )}
      <VaultMenuItemButton
        vault={vault}
        isActive={isActive}
        locale={locale}
        multiWorkspaceEnabled={multiWorkspaceEnabled}
        onSelect={onSelect}
      />
      {multiWorkspaceEnabled && (
        <span className="flex shrink-0 items-center gap-1.5 px-1">
          <DefaultVaultLabel isDefault={isActive} locale={locale} />
          <VaultWorkspaceInitialsBadge vault={vault} />
        </span>
      )}
      <VaultOpenWindowButton locale={locale} vault={vault} />
      {canRemove && (
        <VaultMenuRemoveButton
          locale={locale}
          onRequestRemove={onRequestRemove}
          vault={vault}
        />
      )}
    </div>
  )
}

function reorderedVaultPaths(vaults: VaultOption[], event: DragEndEvent): string[] | null {
  if (!event.over) return null
  return reorderVaultPath(vaults, String(event.active.id), String(event.over.id))
}

function SortableVaultMenuItem(props: { children: ReactNode; id: string }) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id,
  })

  return (
    <div
      ref={setNodeRef}
      style={{
        cursor: isDragging ? 'grabbing' : 'grab',
        opacity: isDragging ? 0.55 : 1,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...listeners}
    >
      {props.children}
    </div>
  )
}

function renderVaultMenuItem(props: VaultMenuListProps, vault: VaultOption) {
  return (
    <VaultMenuItem
      vault={vault}
      isActive={vault.path === props.defaultPath}
      canRemove={props.canRemove && vault.path !== props.defaultPath}
      disableMountToggle={props.disableMountToggleForPath(vault.path)}
      locale={props.locale}
      multiWorkspaceEnabled={props.multiWorkspaceEnabled}
      onSelect={() => { props.onSelectVault(vault.path); }}
      onMountedChange={props.onMountedChange}
      onRequestRemove={props.onRemoveVault
        ? () => { props.setVaultPendingRemoval(vault); }
        : undefined}
    />
  )
}

export function VaultMenuList(props: VaultMenuListProps) {
  const vaultPaths = useMemo(() => vaultPathList(props.vaults), [props.vaults])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragEnd = (event: DragEndEvent) => {
    const reordered = reorderedVaultPaths(props.vaults, event)
    if (reordered) props.onReorderVaults?.(reordered)
  }

  if (!props.onReorderVaults || props.vaults.length < 2) {
    return props.vaults.map((vault) => (
      <div key={vault.path}>{renderVaultMenuItem(props, vault)}</div>
    ))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={vaultPaths} strategy={verticalListSortingStrategy}>
        {props.vaults.map((vault) => (
          <SortableVaultMenuItem key={vault.path} id={vault.path}>
            {renderVaultMenuItem(props, vault)}
          </SortableVaultMenuItem>
        ))}
      </SortableContext>
    </DndContext>
  )
}
