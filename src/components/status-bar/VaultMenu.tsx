import { Cube, FolderOpen, GitBranch, Plus, Rocket } from '@phosphor-icons/react'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ActionTooltip } from '@/components/ui/action-tooltip'
import { Button } from '@/components/ui/button'
import { ConfirmDeleteDialog } from '../ConfirmDeleteDialog'
import { translate, type AppLocale, type TranslationKey } from '../../lib/i18n'
import type { VaultOption } from './types'
import { useDismissibleLayer } from './useDismissibleLayer'
import { applyMountedChange } from './vaultMenuMountedChange'
import { VaultMenuList, type VaultMenuListProps } from './VaultMenuList'

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
}: Pick<
  VaultMenuProps,
  'multiWorkspaceEnabled' | 'onCreateEmptyVault' | 'onCloneGettingStarted' | 'onCloneVault' | 'onOpenLocalFolder'
>): VaultAction[] {
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
  return path === defaultPath && isMounted && (includedVaultCount <= 1 || !canSetDefaultWorkspace)
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

function useVaultMenuInteractions(options: VaultMenuInteractionOptions) {
  const {
    defaultPath,
    includedVaults,
    multiWorkspaceEnabled,
    onSetDefaultWorkspace,
    onSwitchVault,
    onUpdateWorkspaceIdentity,
    setOpen,
    vaultPath,
  } = options
  const disableMountToggleForPath = useCallback(
    (path: string) =>
    shouldDisableMountToggle({
      canSetDefaultWorkspace: !!onSetDefaultWorkspace,
      defaultPath,
      includedVaultCount: includedVaults.length,
      isMounted: includedVaults.find((vault) => vault.path === path)?.mounted !== false,
      path,
      }),
    [defaultPath, includedVaults, onSetDefaultWorkspace],
  )

  const handleSelectVault = useCallback(
    (path: string) => {
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
    },
    [
      defaultPath,
      includedVaults,
      multiWorkspaceEnabled,
      onSetDefaultWorkspace,
      onSwitchVault,
      onUpdateWorkspaceIdentity,
      setOpen,
      vaultPath,
    ],
  )

  const handleMountedChange = useCallback(
    (path: string, mounted: boolean) => {
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
    },
    [defaultPath, includedVaults, onSetDefaultWorkspace, onSwitchVault, onUpdateWorkspaceIdentity, vaultPath],
  )

  return { disableMountToggleForPath, handleMountedChange, handleSelectVault }
}

function VaultMenuHeader({ locale, onOpenVaultSettings }: { locale: AppLocale; onOpenVaultSettings?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-2 py-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {translate(locale, 'status.vault.availableHeader')}
      </span>
      {onOpenVaultSettings && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-auto rounded-sm px-1 py-0.5 text-xs font-medium text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground"
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
  onClick,
  locale = 'en',
}: VaultMenuActionProps & { locale?: AppLocale }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={onClick}
      className="h-auto w-full justify-start rounded-sm px-2 py-1.5 text-sm font-normal"
      style={{
        color: accent ? 'var(--accent-blue)' : 'var(--muted-foreground)',
      }}
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
      message={translate(locale, 'status.vault.removeConfirmMessage', {
        label: vaultPendingRemoval?.label ?? '',
      })}
      confirmLabel={translate(locale, 'status.vault.removeConfirmAction')}
      onCancel={closeDialog}
      onConfirm={confirmRemoval}
    />
  )
}

function VaultMenuPopover(
  options: VaultMenuListProps & {
    actions: VaultAction[]
    menuMinWidth: number
    onOpenVaultSettings?: () => void
    setOpen: (open: boolean) => void
  },
) {
  const {
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
  } = options
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
        padding: 6,
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
            onOpenVaultSettings={
              onOpenVaultSettings
                ? () => {
              onOpenVaultSettings()
              setOpen(false)
                  }
                : undefined
            }
          />
          <div
            style={{
              height: 1,
              background: 'var(--border)',
              margin: '2px 0 4px',
            }}
          />
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
    vaults,
    vaultPath,
    onSwitchVault,
    onOpenLocalFolder,
    onCreateEmptyVault,
    defaultWorkspacePath,
    onSetDefaultWorkspace,
    onOpenVaultSettings,
    onCloneVault,
    onCloneGettingStarted,
    onRemoveVault,
    multiWorkspaceEnabled = false,
    onReorderVaults,
    onUpdateWorkspaceIdentity,
    compact = false,
    locale = 'en',
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
  const menuMinWidth = multiWorkspaceEnabled ? 340 : 220
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
