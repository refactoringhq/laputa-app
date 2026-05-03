import { useEffect } from 'react'
import { Copy, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { McpStatus } from '../hooks/useMcpStatus'
import { createTranslator, type AppLocale } from '../lib/i18n'

interface McpSetupDialogProps {
  open: boolean
  status: McpStatus
  busyAction: 'connect' | 'disconnect' | null
  manualConfigError?: string | null
  manualConfigLoading?: boolean
  manualConfigSnippet?: string | null
  locale?: AppLocale
  onClose: () => void
  onConnect: () => void
  onCopyManualConfig?: () => void
  onDisconnect: () => void
  onLoadManualConfig?: () => void
}

interface ManualMcpConfigSectionProps {
  error?: string | null
  loading: boolean
  locale?: AppLocale
  onCopy?: () => void
  snippet?: string | null
}

interface McpSetupActionsProps {
  buttonsDisabled: boolean
  connectBusy: boolean
  disconnectBusy: boolean
  locale?: AppLocale
  primaryLabel: string
  secondaryLabel: string | null
  onClose: () => void
  onConnect: () => void
  onDisconnect: () => void
}

function isConnected(status: McpStatus): boolean {
  return status === 'installed'
}

function actionCopy(status: McpStatus, t: ReturnType<typeof createTranslator>) {
  if (isConnected(status)) {
    return {
      description: t('mcp.setup.connectedDescription'),
      primaryLabel: t('mcp.setup.reconnect'),
      secondaryLabel: t('mcp.setup.disconnect'),
      title: t('mcp.setup.manageTitle'),
    }
  }

  return {
    description: t('mcp.setup.setupDescription'),
    primaryLabel: t('mcp.setup.connect'),
    secondaryLabel: null,
    title: t('mcp.setup.setupTitle'),
  }
}

function manualConfigText(
  { error, loading, snippet }: ManualMcpConfigSectionProps,
  t: ReturnType<typeof createTranslator>,
): string {
  if (loading) return t('mcp.setup.manual.loading')
  return error ?? snippet ?? t('mcp.setup.manual.unavailable')
}

function ManualMcpConfigSection(props: ManualMcpConfigSectionProps) {
  const t = createTranslator(props.locale)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-sm font-medium text-foreground">{t('mcp.setup.manual.title')}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={props.onCopy}
          disabled={!props.onCopy || props.loading}
          data-testid="mcp-copy-config"
        >
          <Copy size={14} />
          {t('mcp.setup.manual.copy')}
        </Button>
      </div>
      <pre
        tabIndex={0}
        className="max-h-48 overflow-auto rounded-md border border-border bg-background px-3 py-3 font-mono text-xs leading-5 text-foreground"
        data-testid="mcp-config-snippet"
      >
        {manualConfigText(props, t)}
      </pre>
    </div>
  )
}

function McpSetupActions({
  buttonsDisabled,
  connectBusy,
  disconnectBusy,
  locale = 'en',
  primaryLabel,
  secondaryLabel,
  onClose,
  onConnect,
  onDisconnect,
}: McpSetupActionsProps) {
  const t = createTranslator(locale)

  return (
    <DialogFooter
      className="shrink-0 flex-row flex-wrap items-center justify-end gap-2 sm:justify-end"
      data-testid="mcp-setup-actions"
    >
      <Button type="button" variant="outline" onClick={onClose} disabled={buttonsDisabled}>
        {t('common.cancel')}
      </Button>
      {secondaryLabel ? (
        <Button
          type="button"
          variant="destructive"
          onClick={onDisconnect}
          disabled={buttonsDisabled}
          data-testid="mcp-setup-disconnect"
        >
          {disconnectBusy ? t('mcp.setup.disconnecting') : secondaryLabel}
        </Button>
      ) : null}
      <Button
        type="button"
        autoFocus
        onClick={onConnect}
        disabled={buttonsDisabled}
        data-testid="mcp-setup-connect"
      >
        {connectBusy ? t('mcp.setup.connecting') : primaryLabel}
      </Button>
    </DialogFooter>
  )
}

export function McpSetupDialog({
  open,
  status,
  busyAction,
  manualConfigError,
  manualConfigLoading = false,
  manualConfigSnippet,
  locale = 'en',
  onClose,
  onConnect,
  onCopyManualConfig,
  onDisconnect,
  onLoadManualConfig,
}: McpSetupDialogProps) {
  const t = createTranslator(locale)
  const copy = actionCopy(status, t)
  const connectBusy = busyAction === 'connect'
  const disconnectBusy = busyAction === 'disconnect'
  const buttonsDisabled = busyAction !== null || status === 'checking'

  useEffect(() => {
    if (open) onLoadManualConfig?.()
  }, [open, onLoadManualConfig])

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-[520px]"
        data-testid="mcp-setup-dialog"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck size={18} />
            {copy.title}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div
          className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1 text-sm leading-6 text-muted-foreground"
          data-testid="mcp-setup-scroll-body"
        >
          <p>
            {t('mcp.setup.nodeRequirement')}
          </p>
          <p>
            {t('mcp.setup.writeEntryDescription', { entry: 'tolaria' })}
          </p>
          <div className="rounded-md border border-border bg-muted/30 px-3 py-3 font-mono text-xs text-foreground">
            <div>~/.claude.json</div>
            <div>~/.claude/mcp.json</div>
            <div>~/.gemini/settings.json</div>
            <div>~/.cursor/mcp.json</div>
            <div>~/.config/mcp/mcp.json</div>
          </div>
          <ManualMcpConfigSection
            error={manualConfigError}
            loading={manualConfigLoading}
            locale={locale}
            onCopy={onCopyManualConfig}
            snippet={manualConfigSnippet}
          />
          <p>
            {t('mcp.setup.clientPathsDescription')}
          </p>
          <p>
            {t('mcp.setup.geminiGuidanceDescription')}
          </p>
        </div>

        <McpSetupActions
          buttonsDisabled={buttonsDisabled}
          connectBusy={connectBusy}
          disconnectBusy={disconnectBusy}
          locale={locale}
          primaryLabel={copy.primaryLabel}
          secondaryLabel={copy.secondaryLabel}
          onClose={onClose}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
        />
      </DialogContent>
    </Dialog>
  )
}
