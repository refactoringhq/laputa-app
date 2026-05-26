import { Check, Cube, FolderOpen, GitBranch, Plus, Rocket, Warning as AlertTriangle, X } from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  DndContext, PointerSensor, closestCenter, type DragEndEvent, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ActionTooltip } from '@/components/ui/action-tooltip'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDeleteDialog } from '../ConfirmDeleteDialog'
import { WorkspaceInitialsBadge } from '../WorkspaceInitialsBadge'
import { translate, type AppLocale, type TranslationKey } from '../../lib/i18n'
import { trackEvent } from '../../lib/telemetry'
import type { VaultOption } from './types'
import { useDismissibleLayer } from './useDismissibleLayer'
import { workspaceAliasFromOption, workspaceIdentityFromVault } from '../../utils/workspaces'
import { reorderVaultPath, vaultPathList } from '../../utils/vaultOrdering'
import { applyMountedChange } from './vaultMenuMountedChange'

interface VaultMenuProps {
  vaults: VaultOption[]
  vaultPath: string
  defaultWorkspacePath?: string | null
  onSwitchVault: (path: string) => void
  onSetDefaultWorkspace?: (path: string) => void
  onOpenVaultSettings?: () => void
  onOpenLocalFolder?: () => void
  onCreateEmptyVault?: () => void
  onCloneVault?: () => void
  onCloneGettingStarted?: () => void
  onRemoveVault?: (path: string) => void
  onReorderVaults?: (orderedPaths: string[]) => void
  multiWorkspaceEnabled?: boolean
  onUpdateWorkspaceIdentity?: (path: string, patch: Partial<VaultOption>) => void
  compact?: boolean
  locale?: AppLocale
}

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

interface VaultMenuListProps {
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

interface VaultMenuActionProps {
  icon: ReactNode
  labelKey: TranslationKey
  testId: string
  accent?: boolean
  onClick: () => void
}

interface VaultAction {
  key: string
  icon: ReactNode
  labelKey: TranslationKey
  testId: string
  accent?: boolean
  onClick: () => void
}

interface VaultMenuInteractionOptions {
  defaultPath: string
  includedVaults: VaultOption[]
  multiWorkspaceEnabled: boolean
  onSetDefaultWorkspace?: (path: string) => void
  onSwitchVault: (path: string) => void
  onUpdateWorkspaceIdentity?: (path: string, patch: Partial<VaultOption>) => void
  setOpen: (open: boolean) => void
  vaultPath: string
}

interface MountToggleRequest {
  canSetDefaultWorkspace: boolean
  defaultPath: string
  includedVaultCount: number
  isMounted: boolean
  path: string
}

interface VaultPathSelection extends VaultMenuInteractionOptions {
  path: string
}


function getVaultTriggerClassName(open: boolean, compact: boolean) {
  if (compact) {
    return open
      ? 'h-6 w-6 rounded-sm bg-[var(--hover)] p-0 text-foreground hover:bg-[var(--hover)]'
      : 'h-6 w-6 rounded-sm p-0 text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground'
  }

  return open
    ? 'h-auto gap-1 rounded-sm bg-[var(--hover)] px-1 py-0.5 text-[12px] font-medium text-foreground hover:bg-[var(--hover)]'
    : 'h-auto gap-1 rounded-sm px-1 py-0.5 text-[12px] font-medium text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground'
}

function buildVaultActions({
  multiWorkspaceEnabled,
  onCreateEmptyVault,
  onCloneGettingStarted,
  onCloneVault,
  onOpenLocalFolder,
}: Pick<VaultMenuProps, 'multiWorkspaceEnabled' | 'onCreateEmptyVault' | 'onCloneGettingStarted' | 'onCloneVault' | 'onOpenLocalFolder'>): VaultAction[] {
  const items: VaultAction[] = []

  if (onCreateEmptyVault) {
    items.push({
      key: 'create-empty',
      icon: <Plus size={12} />,
      labelKey: 'status.vault.createEmpty',
      testId: 'vault-menu-create-empty',
      accent: !multiWorkspaceEnabled,
      onClick: onCreateEmptyVault,
    })
  }

  if (onOpenLocalFolder) {
    items.push({
      key: 'open-local',
      icon: <FolderOpen size={12} />,
      labelKey: 'status.vault.openLocal',
      testId: 'vault-menu-open-local',
      onClick: onOpenLocalFolder,
    })
  }

  if (onCloneVault) {
    items.push({
      key: 'clone-git',
      icon: <GitBranch size={12} />,
      labelKey: 'status.vault.cloneGit',
      testId: 'vault-menu-clone-git',
      onClick: onCloneVault,
    })
  }

  if (onCloneGettingStarted) {
    items.push({
      key: 'clone-getting-started',
      icon: <Rocket size={12} />,
      labelKey: 'status.vault.cloneGettingStarted',
      testId: 'vault-menu-clone-getting-started',
      accent: true,
      onClick: onCloneGettingStarted,
    })
  }

  return items
}

function VaultMenuIcon({ isActive, unavailable }: { isActive: boolean; unavailable: boolean }) {
  if (isActive) return <Check size={12} />
  if (unavailable) return <AlertTriangle size={12} style={{ color: 'var(--muted-foreground)' }} />
  return <span style={{ width: 12 }} />
}

function workspaceMountLabel(locale: AppLocale, vault: VaultOption): string {
  return translate(locale, 'status.vault.includeWorkspace', { label: vault.label })
}

function WorkspaceMountCheckbox({
  checked,
  disabled,
  locale,
  onMountedChange,
  vault,
}: {
  checked: boolean
  disabled: boolean
  locale: AppLocale
  onMountedChange?: (path: string, mounted: boolean) => void
  vault: VaultOption
}) {
  return (
    <Checkbox
      checked={checked}
      disabled={disabled || !onMountedChange}
      aria-label={workspaceMountLabel(locale, vault)}
      className="ml-1"
      onCheckedChange={(checked) => {
        if (typeof checked !== 'boolean') return
        onMountedChange?.(vault.path, checked)
        trackEvent('workspace_mount_changed', {
          workspace_alias: workspaceAliasFromOption(vault),
          mounted: checked ? 1 : 0,
        })
      }}
    />
  )
}

function vaultMenuItemClassName(isActive: boolean, multiWorkspaceEnabled: boolean): string {
  return [
    'min-w-0 max-w-[190px] flex-none justify-start rounded-sm px-2 font-normal',
    multiWorkspaceEnabled ? 'py-1.5 text-[12px]' : 'py-1 text-xs',
    isActive
      ? 'text-foreground hover:bg-[var(--hover)] hover:text-foreground'
      : 'text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground',
  ].filter(Boolean).join(' ')
}

function vaultMenuItemStyle(unavailable: boolean) {
  return {
    height: 'auto',
    background: 'transparent',
    opacity: unavailable ? 0.45 : 1,
  }
}

function VaultMenuItemButton({
  vault,
  isActive,
  locale,
  multiWorkspaceEnabled,
  onSelect,
}: Pick<VaultMenuItemProps, 'vault' | 'isActive' | 'locale' | 'multiWorkspaceEnabled' | 'onSelect'>) {
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
      className={vaultMenuItemClassName(isActive, multiWorkspaceEnabled)}
      style={vaultMenuItemStyle(unavailable)}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {!multiWorkspaceEnabled && <VaultMenuIcon isActive={isActive} unavailable={unavailable} />}
        <span className="truncate">{vault.label}</span>
      </span>
    </Button>
  )
}

function DefaultVaultLabel({ isDefault, locale }: { isDefault: boolean; locale: AppLocale }) {
  if (!isDefault) return null

  return (
    <span className="text-[10px] font-medium text-muted-foreground" data-testid="vault-menu-default-label">
      {translate(locale, 'workspace.manager.default')}
    </span>
  )
}

function VaultWorkspaceInitialsBadge({ vault }: { vault: VaultOption }) {
  const workspace = workspaceIdentityFromVault(vault)

  return (
    <WorkspaceInitialsBadge
      workspace={workspace}
      testId={`vault-menu-workspace-badge-${vault.label}`}
    />
  )
}

function isIncludedVault(vault: VaultOption, defaultPath: string): boolean {
  return vault.available !== false && (vault.path === defaultPath || vault.mounted !== false)
}

function useIncludedVaults(vaults: VaultOption[], defaultPath: string): VaultOption[] {
  return useMemo(() => vaults.filter((vault) => isIncludedVault(vault, defaultPath)), [defaultPath, vaults])
}

function shouldDisableMountToggle({
  canSetDefaultWorkspace,
  defaultPath,
  includedVaultCount,
  isMounted,
  path,
}: MountToggleRequest): boolean {
  return path === defaultPath
    && isMounted
    && (includedVaultCount <= 1 || !canSetDefaultWorkspace)
}

function selectVaultPath({
  path,
  multiWorkspaceEnabled,
  onSetDefaultWorkspace,
  onSwitchVault,
  setOpen,
}: VaultPathSelection): void {
  if (multiWorkspaceEnabled && onSetDefaultWorkspace) onSetDefaultWorkspace(path)
  else onSwitchVault(path)
  setOpen(false)
}

function useVaultMenuInteractions({
  defaultPath,
  includedVaults,
  multiWorkspaceEnabled,
  onSetDefaultWorkspace,
  onSwitchVault,
  onUpdateWorkspaceIdentity,
  setOpen,
  vaultPath,
}: VaultMenuInteractionOptions) {
  const disableMountToggleForPath = useCallback((path: string) => (
    shouldDisableMountToggle({
      canSetDefaultWorkspace: !!onSetDefaultWorkspace,
      defaultPath,
      includedVaultCount: includedVaults.length,
      isMounted: includedVaults.find((vault) => vault.path === path)?.mounted !== false,
      path,
    })
  ), [defaultPath, includedVaults, onSetDefaultWorkspace])

  const handleSelectVault = useCallback((path: string) => {
    selectVaultPath({
      defaultPath,
      includedVaults,
      multiWorkspaceEnabled,
      onSetDefaultWorkspace,
      onSwitchVault,
      onUpdateWorkspaceIdentity,
      path,
      setOpen,
      vaultPath,
    })
  }, [defaultPath, includedVaults, multiWorkspaceEnabled, onSetDefaultWorkspace, onSwitchVault, onUpdateWorkspaceIdentity, setOpen, vaultPath])

  const handleMountedChange = useCallback((path: string, mounted: boolean) => {
    applyMountedChange({
      defaultPath,
      vaultPath,
      includedVaults,
      mounted,
      path,
      callbacks: {
        onSetDefaultWorkspace,
        onSwitchVault,
        onUpdateWorkspaceIdentity,
      },
    })
  }, [defaultPath, includedVaults, onSetDefaultWorkspace, onSwitchVault, onUpdateWorkspaceIdentity, vaultPath])

  return { disableMountToggleForPath, handleMountedChange, handleSelectVault }
}

function VaultMenuRemoveButton({
  locale,
  onRequestRemove,
  vault,
}: Pick<VaultMenuItemProps, 'locale' | 'onRequestRemove' | 'vault'>) {
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
      className="ml-0.5 h-6 w-6 shrink-0 rounded-sm text-muted-foreground opacity-0 pointer-events-none transition-opacity hover:bg-[var(--hover)] hover:text-foreground focus-visible:opacity-100 focus-visible:pointer-events-auto group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
    >
      <X size={10} />
    </Button>
  )
}

function VaultMenuItem({
  vault,
  isActive,
  canRemove,
  disableMountToggle,
  locale,
  multiWorkspaceEnabled,
  onSelect,
  onMountedChange,
  onRequestRemove,
}: VaultMenuItemProps) {
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
    return () => item.removeEventListener('click', handleItemClick)
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
      {canRemove && <VaultMenuRemoveButton locale={locale} onRequestRemove={onRequestRemove} vault={vault} />}
      {multiWorkspaceEnabled && (
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2 pr-1">
          <DefaultVaultLabel isDefault={isActive} locale={locale} />
          <VaultWorkspaceInitialsBadge vault={vault} />
        </span>
      )}
    </div>
  )
}

function reorderedVaultPaths(vaults: VaultOption[], event: DragEndEvent): string[] | null {
  const { active, over } = event
  if (!over) return null

  return reorderVaultPath(vaults, String(active.id), String(over.id))
}

function SortableVaultMenuItem({
  children,
  id,
}: {
  children: ReactNode
  id: string
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  return (
    <div
      ref={setNodeRef}
      style={{
        cursor: isDragging ? 'grabbing' : 'grab',
        opacity: isDragging ? 0.55 : 1,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  )
}

function renderVaultMenuItem({
  canRemove,
  defaultPath,
  disableMountToggleForPath,
  locale,
  multiWorkspaceEnabled,
  onMountedChange,
  onRemoveVault,
  onSelectVault,
  setVaultPendingRemoval,
  vault,
}: Omit<VaultMenuListProps, 'onReorderVaults' | 'vaults'> & { vault: VaultOption }) {
  return (
    <VaultMenuItem
      vault={vault}
      isActive={vault.path === defaultPath}
      canRemove={canRemove && vault.path !== defaultPath}
      disableMountToggle={disableMountToggleForPath(vault.path)}
      locale={locale}
      multiWorkspaceEnabled={multiWorkspaceEnabled}
      onSelect={() => onSelectVault(vault.path)}
      onMountedChange={onMountedChange}
      onRequestRemove={onRemoveVault ? () => setVaultPendingRemoval(vault) : undefined}
    />
  )
}

function VaultMenuList(props: VaultMenuListProps) {
  const { onReorderVaults, vaults } = props
  const vaultPaths = useMemo(() => vaultPathList(vaults), [vaults])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragEnd = (event: DragEndEvent) => {
    const reordered = reorderedVaultPaths(vaults, event)
    if (reordered) onReorderVaults?.(reordered)
  }

  if (!onReorderVaults || vaults.length < 2) {
    return vaults.map((vault) => (
      <div key={vault.path}>
        {renderVaultMenuItem({ ...props, vault })}
      </div>
    ))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={vaultPaths} strategy={verticalListSortingStrategy}>
        {vaults.map((vault) => (
          <SortableVaultMenuItem key={vault.path} id={vault.path}>
            {renderVaultMenuItem({ ...props, vault })}
          </SortableVaultMenuItem>
        ))}
      </SortableContext>
    </DndContext>
  )
}

function VaultMenuHeader({
  locale,
  onOpenVaultSettings,
}: {
  locale: AppLocale
  onOpenVaultSettings?: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-2 py-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {translate(locale, 'status.vault.availableHeader')}
      </span>
      {onOpenVaultSettings && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-auto rounded-sm px-1 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground"
          onClick={onOpenVaultSettings}
          data-testid="vault-menu-manage-vaults"
        >
          {translate(locale, 'status.vault.manageWorkspaces')}
        </Button>
      )}
    </div>
  )
}

function VaultMenuAction({
  icon,
  labelKey,
  testId,
  accent = false,
  multiWorkspaceEnabled,
  onClick,
  locale = 'en',
}: VaultMenuActionProps & { locale?: AppLocale; multiWorkspaceEnabled: boolean }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={onClick}
      className={`h-auto w-full justify-start rounded-sm px-2 py-1 font-normal ${multiWorkspaceEnabled ? 'text-[12px]' : 'text-xs'}`}
      style={{ color: accent ? 'var(--accent-blue)' : 'var(--muted-foreground)' }}
      data-testid={testId}
    >
      {icon}
      {translate(locale, labelKey)}
    </Button>
  )
}

function VaultMenuRemoveConfirmDialog({
  locale,
  onRemoveVault,
  setOpen,
  setVaultPendingRemoval,
  vaultPendingRemoval,
}: {
  locale: AppLocale
  onRemoveVault?: (path: string) => void
  setOpen: (open: boolean) => void
  setVaultPendingRemoval: (vault: VaultOption | null) => void
  vaultPendingRemoval: VaultOption | null
}) {
  const closeDialog = () => setVaultPendingRemoval(null)
  const confirmRemoval = () => {
    if (vaultPendingRemoval) onRemoveVault?.(vaultPendingRemoval.path)
    setVaultPendingRemoval(null)
    setOpen(false)
  }

  return (
    <ConfirmDeleteDialog
      open={!!vaultPendingRemoval}
      title={translate(locale, 'status.vault.removeConfirmTitle')}
      message={translate(locale, 'status.vault.removeConfirmMessage', { label: vaultPendingRemoval?.label ?? '' })}
      confirmLabel={translate(locale, 'status.vault.removeConfirmAction')}
      onCancel={closeDialog}
      onConfirm={confirmRemoval}
    />
  )
}

function VaultMenuPopover({
  actions,
  canRemove,
  defaultPath,
  disableMountToggleForPath,
  locale,
  menuMinWidth,
  multiWorkspaceEnabled,
  onMountedChange,
  onOpenVaultSettings,
  onRemoveVault,
  onReorderVaults,
  onSelectVault,
  setOpen,
  setVaultPendingRemoval,
  vaults,
}: VaultMenuListProps & {
  actions: VaultAction[]
  menuMinWidth: number
  onOpenVaultSettings?: () => void
  setOpen: (open: boolean) => void
}) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        marginBottom: 4,
        background: 'var(--sidebar)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: 4,
        minWidth: menuMinWidth,
        boxShadow: '0 4px 12px var(--shadow-dialog)',
        zIndex: 1000,
      }}
      data-testid="vault-menu-popover"
    >
      {multiWorkspaceEnabled && (
        <>
          <VaultMenuHeader
            locale={locale}
            onOpenVaultSettings={onOpenVaultSettings ? () => {
              onOpenVaultSettings()
              setOpen(false)
            } : undefined}
          />
          <div style={{ height: 1, background: 'var(--border)', margin: '2px 0 4px' }} />
        </>
      )}
      <VaultMenuList
        canRemove={canRemove}
        defaultPath={defaultPath}
        disableMountToggleForPath={disableMountToggleForPath}
        locale={locale}
        multiWorkspaceEnabled={multiWorkspaceEnabled}
        onMountedChange={onMountedChange}
        onRemoveVault={onRemoveVault}
        onReorderVaults={onReorderVaults}
        onSelectVault={onSelectVault}
        setVaultPendingRemoval={setVaultPendingRemoval}
        vaults={vaults}
      />
      {actions.length > 0 && <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />}
      {actions.map((action) => (
        <VaultMenuAction
          key={action.key}
          icon={action.icon}
          labelKey={action.labelKey}
          testId={action.testId}
          accent={action.accent}
          multiWorkspaceEnabled={multiWorkspaceEnabled}
          locale={locale}
          onClick={() => {
            action.onClick()
            setOpen(false)
          }}
        />
      ))}
    </div>
  )
}

export function VaultMenu(props: VaultMenuProps) {
  const {
    vaults, vaultPath, onSwitchVault, onOpenLocalFolder, onCreateEmptyVault,
    defaultWorkspacePath, onSetDefaultWorkspace, onOpenVaultSettings,
    onCloneVault, onCloneGettingStarted, onRemoveVault, multiWorkspaceEnabled = false,
    onReorderVaults, onUpdateWorkspaceIdentity, compact = false, locale = 'en',
  } = props
  const [open, setOpen] = useState(false)
  const [vaultPendingRemoval, setVaultPendingRemoval] = useState<VaultOption | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const defaultPath = multiWorkspaceEnabled ? (defaultWorkspacePath ?? vaultPath) : vaultPath
  const activeVault = vaults.find((vault) => vault.path === defaultPath)
  const canRemove = !!onRemoveVault && vaults.length > 1
  const triggerClassName = getVaultTriggerClassName(open, compact)
  const triggerSize = compact ? 'icon-xs' : 'xs'
  const activeVaultLabel = activeVault?.label ?? translate(locale, 'status.vault.default')
  const menuMinWidth = multiWorkspaceEnabled ? 320 : 200
  const includedVaults = useIncludedVaults(vaults, defaultPath)
  const { disableMountToggleForPath, handleMountedChange, handleSelectVault } = useVaultMenuInteractions({
    defaultPath,
    includedVaults,
    multiWorkspaceEnabled,
    onSetDefaultWorkspace,
    onSwitchVault,
    onUpdateWorkspaceIdentity,
    setOpen,
    vaultPath,
  })

  useDismissibleLayer(open, menuRef, () => setOpen(false))

  const actions = useMemo<VaultAction[]>(() => {
    return buildVaultActions({
      multiWorkspaceEnabled,
      onCreateEmptyVault,
      onCloneGettingStarted,
      onCloneVault,
      onOpenLocalFolder,
    })
  }, [multiWorkspaceEnabled, onCreateEmptyVault, onCloneGettingStarted, onCloneVault, onOpenLocalFolder])

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <ActionTooltip copy={{ label: translate(locale, 'status.vault.switch') }} side="top">
        <Button
          type="button"
          variant="ghost"
          size={triggerSize}
          className={triggerClassName}
          onClick={() => setOpen((value) => !value)}
          aria-label={translate(locale, 'status.vault.switch')}
          data-testid="status-vault-trigger"
        >
          <Cube size={13} weight="regular" />
          {compact ? null : <span className="max-w-32 truncate">{activeVaultLabel}</span>}
        </Button>
      </ActionTooltip>
      {open && (
        <VaultMenuPopover
          actions={actions}
          canRemove={canRemove}
          defaultPath={defaultPath}
          disableMountToggleForPath={disableMountToggleForPath}
          locale={locale}
          menuMinWidth={menuMinWidth}
          multiWorkspaceEnabled={multiWorkspaceEnabled}
          onMountedChange={handleMountedChange}
          onOpenVaultSettings={onOpenVaultSettings}
          onRemoveVault={onRemoveVault}
          onReorderVaults={onReorderVaults}
          onSelectVault={handleSelectVault}
          setOpen={setOpen}
          setVaultPendingRemoval={setVaultPendingRemoval}
          vaults={vaults}
        />
      )}
      <VaultMenuRemoveConfirmDialog
        locale={locale}
        onRemoveVault={onRemoveVault}
        setOpen={setOpen}
        setVaultPendingRemoval={setVaultPendingRemoval}
        vaultPendingRemoval={vaultPendingRemoval}
      />
    </div>
  )
}
