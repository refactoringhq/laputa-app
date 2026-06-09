import { Info, Trash as Trash2 } from '@phosphor-icons/react'
import { type KeyboardEvent, useState } from 'react'
import { AccentColorPicker } from './AccentColorPicker'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { SettingsGroupItem } from './SettingsControls'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { WorkspaceMoveButtons } from './WorkspaceMoveButtons'
import { createTranslator, type AppLocale } from '../lib/i18n'
import { trackEvent } from '../lib/telemetry'
import type { VaultOption } from './status-bar/types'
import { canMoveVaultPath, moveVaultPath, type VaultMoveDirection } from '../utils/vaultOrdering'
import { workspaceIdentityFromVault } from '../utils/workspaces'

interface WorkspaceSettingsRowsProps {
  defaultWorkspacePath?: string | null
  locale: AppLocale
  onRemoveVault?: (path: string) => void
  onReorderVaults?: (orderedPaths: string[]) => void
  onSetDefaultWorkspace?: (path: string) => void
  onUpdateWorkspaceIdentity?: (path: string, patch: Partial<VaultOption>) => void
  vaults: VaultOption[]
}

function workspaceInputId(alias: string, field: 'name' | 'label' | 'slug'): string {
  return `settings-workspace-${alias}-${field}`
}

function sanitizeWorkspaceShortLabel(value: string): string {
  return value.trim().toUpperCase().slice(0, 3)
}

function WorkspaceFieldLabel({
  htmlFor,
  label,
  tooltip,
}: {
  htmlFor: string
  label: string
  tooltip: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <label className="truncate text-[11px] font-medium text-muted-foreground" htmlFor={htmlFor}>
        {label}
      </label>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="h-4 w-4 shrink-0 rounded-full p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={tooltip}
          >
            <Info size={12} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" align="start">{tooltip}</TooltipContent>
      </Tooltip>
    </div>
  )
}

function WorkspaceIdentityInputs({
  canEdit,
  locale,
  onUpdateWorkspaceIdentity,
  vault,
}: Pick<WorkspaceSettingsRowsProps, 'locale' | 'onUpdateWorkspaceIdentity'> & {
  canEdit: boolean
  vault: VaultOption
}) {
  const t = createTranslator(locale)
  const workspace = workspaceIdentityFromVault(vault)
  const nameId = workspaceInputId(workspace.alias, 'name')
  const labelId = workspaceInputId(workspace.alias, 'label')
  const slugId = workspaceInputId(workspace.alias, 'slug')
  const savedNameDraft = vault.label ?? ''
  const savedShortLabelDraft = sanitizeWorkspaceShortLabel(vault.shortLabel || workspace.shortLabel)
  const [nameDraft, setNameDraft] = useState(savedNameDraft)
  const [shortLabelDraft, setShortLabelDraft] = useState(savedShortLabelDraft)

  const commitNameDraft = () => {
    if (!canEdit || nameDraft === savedNameDraft) return
    onUpdateWorkspaceIdentity?.(vault.path, { label: nameDraft })
  }

  const commitShortLabelDraft = () => {
    const normalizedShortLabel = sanitizeWorkspaceShortLabel(shortLabelDraft)
    if (!canEdit || normalizedShortLabel === savedShortLabelDraft) return
    onUpdateWorkspaceIdentity?.(vault.path, { shortLabel: normalizedShortLabel })
  }

  const blurOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur()
  }

  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(80px,0.28fr)_minmax(140px,0.55fr)]">
      <div className="grid gap-1.5">
        <WorkspaceFieldLabel htmlFor={nameId} label={t('settings.workspaces.name')} tooltip={t('settings.workspaces.nameTooltip')} />
        <Input
          id={nameId}
          value={nameDraft}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={commitNameDraft}
          onKeyDown={blurOnEnter}
          aria-label={t('settings.workspaces.nameAria', { label: workspace.label })}
          disabled={!canEdit}
          className="h-8 bg-transparent"
        />
      </div>
      <div className="grid gap-1.5">
        <WorkspaceFieldLabel htmlFor={labelId} label={t('settings.workspaces.label')} tooltip={t('settings.workspaces.labelTooltip')} />
        <Input
          id={labelId}
          value={shortLabelDraft}
          maxLength={3}
          onChange={(event) => setShortLabelDraft(sanitizeWorkspaceShortLabel(event.target.value))}
          onBlur={commitShortLabelDraft}
          onKeyDown={blurOnEnter}
          aria-label={t('settings.workspaces.labelAria', { label: workspace.label })}
          disabled={!canEdit}
          className="h-8 bg-transparent uppercase"
        />
      </div>
      <div className="grid gap-1.5">
        <WorkspaceFieldLabel htmlFor={slugId} label={t('settings.workspaces.slug')} tooltip={t('settings.workspaces.slugTooltip')} />
        <Input
          id={slugId}
          value={vault.alias ?? workspace.alias}
          aria-label={t('settings.workspaces.slugAria', { label: workspace.label })}
          readOnly
          aria-readonly="true"
          className="h-8 cursor-default bg-muted/30 text-muted-foreground"
        />
      </div>
    </div>
  )
}

function WorkspaceRowActions({
  canEdit,
  canMoveDown,
  canMoveUp,
  locale,
  onMoveVault,
  onSetDefaultWorkspace,
  onUpdateWorkspaceIdentity,
  onRequestRemoveVault,
  workspace,
  vault,
}: Pick<WorkspaceSettingsRowsProps, 'locale' | 'onSetDefaultWorkspace' | 'onUpdateWorkspaceIdentity'> & {
  canEdit: boolean
  canMoveDown: boolean
  canMoveUp: boolean
  onMoveVault?: (path: string, direction: VaultMoveDirection) => void
  onRequestRemoveVault?: () => void
  workspace: ReturnType<typeof workspaceIdentityFromVault>
  vault: VaultOption
}) {
  const t = createTranslator(locale)
  const removeLabel = t('settings.workspaces.removeAria', { label: workspace.label })

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
      <WorkspaceMoveButtons canMoveDown={canMoveDown} canMoveUp={canMoveUp} locale={locale} onMoveVault={onMoveVault} vault={vault} workspace={workspace} />
      <AccentColorPicker
        className="gap-1.5"
        disabled={!canEdit}
        selectedColor={vault.color ?? null}
        onSelectColor={(color) => onUpdateWorkspaceIdentity?.(vault.path, { color })}
        size={18}
      />
      <Button
        type="button"
        variant="secondary"
        size="xs"
        onClick={() => {
          onSetDefaultWorkspace?.(vault.path)
          trackEvent('workspace_default_changed', { workspace_alias: workspace.alias })
        }}
        disabled={!onSetDefaultWorkspace || workspace.defaultForNewNotes}
        data-testid={`settings-workspace-default-${workspace.alias}`}
      >
        {workspace.defaultForNewNotes ? t('workspace.manager.default') : t('workspace.manager.makeDefault')}
      </Button>
      {onRequestRemoveVault && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRequestRemoveVault}
          disabled={workspace.defaultForNewNotes}
          aria-label={removeLabel}
          title={removeLabel}
          data-testid={`settings-workspace-remove-${workspace.alias}`}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 size={15} />
        </Button>
      )}
    </div>
  )
}

function WorkspaceRemovalConfirmation({
  locale,
  onCancel,
  onConfirm,
  workspace,
}: Pick<WorkspaceSettingsRowsProps, 'locale'> & {
  onCancel: () => void
  onConfirm: () => void
  workspace: ReturnType<typeof workspaceIdentityFromVault>
}) {
  const t = createTranslator(locale)
  const title = t('status.vault.removeConfirmTitle')

  return (
    <div
      role="group"
      aria-label={title}
      className="rounded-md border border-destructive/40 bg-destructive/5 p-3"
      data-testid={`settings-workspace-remove-confirm-${workspace.alias}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onCancel()
      }}
    >
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">
        {t('status.vault.removeConfirmMessage', { label: workspace.label })}
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" size="xs" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="button" variant="destructive" size="xs" onClick={onConfirm}>
          {t('status.vault.removeConfirmAction')}
        </Button>
      </div>
    </div>
  )
}

function WorkspaceSettingsRow({
  defaultWorkspacePath,
  locale,
  onCancelRemoveVault,
  onConfirmRemoveVault,
  onMoveVault,
  onRequestRemoveVault,
  onSetDefaultWorkspace,
  onUpdateWorkspaceIdentity,
  vaults,
  vault,
  pendingRemoval,
}: Pick<WorkspaceSettingsRowsProps, 'defaultWorkspacePath' | 'locale' | 'onSetDefaultWorkspace' | 'onUpdateWorkspaceIdentity' | 'vaults'> & {
  onCancelRemoveVault: () => void
  onConfirmRemoveVault?: () => void
  onMoveVault?: (path: string, direction: VaultMoveDirection) => void
  onRequestRemoveVault?: () => void
  pendingRemoval: boolean
  vault: VaultOption
}) {
  const workspace = workspaceIdentityFromVault(vault, { defaultWorkspacePath })
  const canEdit = !!onUpdateWorkspaceIdentity && vault.path !== '' && !vault.managedDefault

  return (
    <div className="grid gap-3 px-4 py-4" data-testid={`settings-workspace-row-${workspace.alias}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-[220px] flex-1">
          <div className="truncate text-sm font-medium text-foreground">{workspace.label}</div>
          <div className="truncate text-[11px] text-muted-foreground">{workspace.path}</div>
        </div>
        <WorkspaceRowActions
          canEdit={canEdit}
          canMoveDown={canMoveVaultPath(vaults, vault.path, 'down')}
          canMoveUp={canMoveVaultPath(vaults, vault.path, 'up')}
          locale={locale}
          onMoveVault={onMoveVault}
          onSetDefaultWorkspace={onSetDefaultWorkspace}
          onUpdateWorkspaceIdentity={onUpdateWorkspaceIdentity}
          onRequestRemoveVault={onRequestRemoveVault}
          workspace={workspace}
          vault={vault}
        />
      </div>
      {pendingRemoval && onConfirmRemoveVault && (
        <WorkspaceRemovalConfirmation
          locale={locale}
          onCancel={onCancelRemoveVault}
          onConfirm={onConfirmRemoveVault}
          workspace={workspace}
        />
      )}
      <WorkspaceIdentityInputs canEdit={canEdit} locale={locale} onUpdateWorkspaceIdentity={onUpdateWorkspaceIdentity} vault={vault} />
    </div>
  )
}

function moveVaultInList(
  vaults: VaultOption[],
  onReorderVaults: ((orderedPaths: string[]) => void) | undefined,
  path: string,
  direction: VaultMoveDirection,
) {
  const orderedPaths = moveVaultPath(vaults, path, direction)
  if (orderedPaths) onReorderVaults?.(orderedPaths)
}

export function WorkspaceSettingsRows({
  defaultWorkspacePath,
  locale,
  onRemoveVault,
  onReorderVaults,
  onSetDefaultWorkspace,
  onUpdateWorkspaceIdentity,
  vaults,
}: WorkspaceSettingsRowsProps) {
  const [pendingRemovalPath, setPendingRemovalPath] = useState<string | null>(null)

  const moveVault = (path: string, direction: VaultMoveDirection) => {
    moveVaultInList(vaults, onReorderVaults, path, direction)
  }

  return (
    <SettingsGroupItem testId="settings-workspace-list">
      <div className="-mx-4 divide-y divide-border">
        {vaults.map((vault) => (
          <WorkspaceSettingsRow
            key={vault.path}
            defaultWorkspacePath={defaultWorkspacePath}
            locale={locale}
            onCancelRemoveVault={() => setPendingRemovalPath(null)}
            onConfirmRemoveVault={onRemoveVault ? () => {
              onRemoveVault(vault.path)
              setPendingRemovalPath(null)
            } : undefined}
            onMoveVault={onReorderVaults ? moveVault : undefined}
            onRequestRemoveVault={onRemoveVault ? () => setPendingRemovalPath(vault.path) : undefined}
            onSetDefaultWorkspace={onSetDefaultWorkspace}
            onUpdateWorkspaceIdentity={onUpdateWorkspaceIdentity}
            pendingRemoval={pendingRemovalPath === vault.path}
            vaults={vaults}
            vault={vault}
          />
        ))}
      </div>
    </SettingsGroupItem>
  )
}
