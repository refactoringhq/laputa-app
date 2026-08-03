import { Cube } from '@phosphor-icons/react'
import { createElement, useMemo, useRef, useState } from 'react'
import { ActionTooltip } from '@/components/ui/action-tooltip'
import { Button } from '@/components/ui/button'
import { ConfirmDeleteDialog } from '../ConfirmDeleteDialog'
import { translate } from '../../lib/i18n'
import type { VaultOption } from './types'
import { useDismissibleLayer } from './useDismissibleLayer'
import { buildVaultActions } from './vaultMenuActions'
import { useIncludedVaults, useVaultMenuInteractions } from './vaultMenuInteractions'
import { getVaultTriggerClassName } from './vaultMenuTrigger'
import { VaultMenuList } from './VaultMenuList'
import type {
  VaultMenuActionComponentProps,
  VaultMenuHeaderProps,
  VaultMenuPopoverProps,
  VaultMenuRemoveConfirmDialogProps,
  VaultMenuWorkspaceSectionProps,
} from './vaultMenuComponentTypes'
import type { VaultAction, VaultMenuProps } from './vaultMenuTypes'

function VaultMenuHeader(props: VaultMenuHeaderProps) {
  const { locale, onOpenVaultSettings } = props
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

function VaultMenuWorkspaceSection(props: VaultMenuWorkspaceSectionProps) {
  const { locale, onOpenVaultSettings, setOpen } = props
  const openSettings = onOpenVaultSettings
    ? () => {
        onOpenVaultSettings()
        setOpen(false)
      }
    : undefined

  return (
    <>
      <VaultMenuHeader locale={locale} onOpenVaultSettings={openSettings} />
      <div
        style={{
          height: 1,
          background: 'var(--border)',
          margin: '2px 0 4px',
        }}
      />
    </>
  )
}

function VaultMenuAction(props: VaultMenuActionComponentProps) {
  const { Icon, labelKey, testId, accent = false, onClick, locale = 'en' } = props
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
      {createElement(Icon, { size: 12 })}
      {translate(locale, labelKey)}
    </Button>
  )
}

function VaultMenuRemoveConfirmDialog(props: VaultMenuRemoveConfirmDialogProps) {
  const { locale, onRemoveVault, setOpen, setVaultPendingRemoval, vaultPendingRemoval } = props
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
  options: VaultMenuPopoverProps,
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
        <VaultMenuWorkspaceSection
          locale={locale}
          onOpenVaultSettings={onOpenVaultSettings}
          setOpen={setOpen}
        />
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
          Icon={action.Icon}
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
