import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, Check, FolderOpen, GitBranch, Plus, Rocket, X } from 'lucide-react'
import { ActionTooltip } from '@/components/ui/action-tooltip'
import { Button } from '@/components/ui/button'
import { translate, type AppLocale, type TranslationKey } from '../../lib/i18n'
import type { VaultOption } from './types'
import { useDismissibleLayer } from './useDismissibleLayer'

interface VaultMenuProps {
  vaults: VaultOption[]
  vaultPath: string
  onSwitchVault: (path: string) => void
  onOpenLocalFolder?: () => void
  onCreateEmptyVault?: () => void
  onCloneVault?: () => void
  onCloneGettingStarted?: () => void
  onRemoveVault?: (path: string) => void
  compact?: boolean
  locale?: AppLocale
}

interface VaultMenuItemProps {
  vault: VaultOption
  isActive: boolean
  canRemove: boolean
  locale: AppLocale
  onSelect: () => void
  onRemove?: () => void
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
  onCreateEmptyVault,
  onCloneGettingStarted,
  onCloneVault,
  onOpenLocalFolder,
}: Pick<VaultMenuProps, 'onCreateEmptyVault' | 'onCloneGettingStarted' | 'onCloneVault' | 'onOpenLocalFolder'>): VaultAction[] {
  const items: VaultAction[] = []

  if (onCreateEmptyVault) {
    items.push({
      key: 'create-empty',
      icon: <Plus size={12} />,
      labelKey: 'status.vault.createEmpty',
      testId: 'vault-menu-create-empty',
      accent: true,
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

function VaultMenuItem({ vault, isActive, canRemove, locale, onSelect, onRemove }: VaultMenuItemProps) {
  const unavailable = vault.available === false
  const removeLabel = translate(locale, 'status.vault.remove', { label: vault.label })
  const itemClassName = [
    'w-full justify-start rounded-sm px-2 py-1 text-xs font-normal',
    canRemove ? 'pr-7' : '',
    isActive
      ? 'text-foreground hover:bg-[var(--hover)] hover:text-foreground'
      : 'text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground',
  ].filter(Boolean).join(' ')

  return (
    <div className="group relative flex w-full items-center rounded-sm">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={unavailable}
        onClick={onSelect}
        aria-current={isActive ? 'true' : undefined}
        title={unavailable ? translate(locale, 'status.vault.notFound', { path: vault.path }) : vault.path}
        data-testid={`vault-menu-item-${vault.label}`}
        className={itemClassName}
        style={{
          height: 'auto',
          background: isActive ? 'var(--hover)' : 'transparent',
          opacity: unavailable ? 0.45 : 1,
        }}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <VaultMenuIcon isActive={isActive} unavailable={unavailable} />
          <span className="truncate">{vault.label}</span>
        </span>
      </Button>
      {canRemove && onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
          title={removeLabel}
          aria-label={removeLabel}
          data-testid={`vault-menu-remove-${vault.label}`}
          className="absolute top-1/2 right-1 -translate-y-1/2 rounded-sm text-muted-foreground opacity-0 pointer-events-none transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:pointer-events-auto group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
        >
          <X size={10} />
        </Button>
      )}
    </div>
  )
}

function VaultMenuAction({ icon, labelKey, testId, accent = false, onClick, locale = 'en' }: VaultMenuActionProps & { locale?: AppLocale }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={onClick}
      className="h-auto w-full justify-start rounded-sm px-2 py-1 text-xs font-normal"
      style={{ color: accent ? 'var(--accent-blue)' : 'var(--muted-foreground)' }}
      data-testid={testId}
    >
      {icon}
      {translate(locale, labelKey)}
    </Button>
  )
}

export function VaultMenu({
  vaults,
  vaultPath,
  onSwitchVault,
  onOpenLocalFolder,
  onCreateEmptyVault,
  onCloneVault,
  onCloneGettingStarted,
  onRemoveVault,
  compact = false,
  locale = 'en',
}: VaultMenuProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const activeVault = vaults.find((vault) => vault.path === vaultPath)
  const canRemove = !!onRemoveVault && vaults.length > 1
  const triggerClassName = getVaultTriggerClassName(open, compact)
  const triggerSize = compact ? 'icon-xs' : 'xs'
  const activeVaultLabel = activeVault?.label ?? translate(locale, 'status.vault.default')

  useDismissibleLayer(open, menuRef, () => setOpen(false))

  const actions = useMemo<VaultAction[]>(() => {
    return buildVaultActions({
      onCreateEmptyVault,
      onCloneGettingStarted,
      onCloneVault,
      onOpenLocalFolder,
    })
  }, [onCreateEmptyVault, onCloneGettingStarted, onCloneVault, onOpenLocalFolder])

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
          <FolderOpen size={13} />
          {compact ? null : <span className="max-w-32 truncate">{activeVaultLabel}</span>}
        </Button>
      </ActionTooltip>
      {open && (
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
            minWidth: 200,
            boxShadow: '0 4px 12px var(--shadow-dialog)',
            zIndex: 1000,
          }}
        >
          {vaults.map((vault) => (
            <VaultMenuItem
              key={vault.path}
              vault={vault}
              isActive={vault.path === vaultPath}
              canRemove={canRemove}
              locale={locale}
              onSelect={() => {
                onSwitchVault(vault.path)
                setOpen(false)
              }}
              onRemove={onRemoveVault ? () => {
                onRemoveVault(vault.path)
                setOpen(false)
              } : undefined}
            />
          ))}
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
      )}
    </div>
  )
}
