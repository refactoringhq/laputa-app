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

interface McpSetupDialogProps {
  open: boolean
  status: McpStatus
  busyAction: 'connect' | 'disconnect' | null
  manualConfigError?: string | null
  manualConfigLoading?: boolean
  manualConfigSnippet?: string | null
  onClose: () => void
  onConnect: () => void
  onCopyManualConfig?: () => void
  onDisconnect: () => void
  onLoadManualConfig?: () => void
}

interface ManualMcpConfigSectionProps {
  error?: string | null
  loading: boolean
  onCopy?: () => void
  snippet?: string | null
}

interface McpSetupActionsProps {
  buttonsDisabled: boolean
  connectBusy: boolean
  disconnectBusy: boolean
  primaryLabel: string
  secondaryLabel: string | null
  onClose: () => void
  onConnect: () => void
  onDisconnect: () => void
}

function isConnected(status: McpStatus): boolean {
  return status === 'installed'
}

function actionCopy(status: McpStatus) {
  if (isConnected(status)) {
    return {
      description: 'Tolaria is already connected to external AI tools for this vault. Reconnect to refresh the configuration, or disconnect to remove Tolaria from those third-party config files.',
      primaryLabel: 'Reconnect External AI Tools',
      secondaryLabel: 'Disconnect',
      title: 'Manage External AI Tools',
    }
  }

  return {
    description: 'Tolaria can add its MCP server to external AI tools for this vault, but it will not touch third-party config files until you confirm here.',
    primaryLabel: 'Connect External AI Tools',
    secondaryLabel: null,
    title: 'Set Up External AI Tools',
  }
}

function manualConfigText({ error, loading, snippet }: ManualMcpConfigSectionProps): string {
  if (loading) return 'Loading exact MCP config...'
  return error ?? snippet ?? 'Exact config is available after a vault is open.'
}

function ManualMcpConfigSection(props: ManualMcpConfigSectionProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-sm font-medium text-foreground">Manual MCP config</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={props.onCopy}
          disabled={!props.onCopy || props.loading}
          data-testid="mcp-copy-config"
        >
          <Copy size={14} />
          Copy MCP config
        </Button>
      </div>
      <pre
        tabIndex={0}
        className="max-h-48 overflow-auto rounded-md border border-border bg-background px-3 py-3 font-mono text-xs leading-5 text-foreground"
        data-testid="mcp-config-snippet"
      >
        {manualConfigText(props)}
      </pre>
    </div>
  )
}

function McpSetupActions({
  buttonsDisabled,
  connectBusy,
  disconnectBusy,
  primaryLabel,
  secondaryLabel,
  onClose,
  onConnect,
  onDisconnect,
}: McpSetupActionsProps) {
  return (
    <DialogFooter className="flex-row items-center justify-end gap-2 sm:justify-end">
      <Button type="button" variant="outline" onClick={onClose} disabled={buttonsDisabled}>
        Cancel
      </Button>
      {secondaryLabel ? (
        <Button
          type="button"
          variant="destructive"
          onClick={onDisconnect}
          disabled={buttonsDisabled}
          data-testid="mcp-setup-disconnect"
        >
          {disconnectBusy ? 'Disconnecting…' : secondaryLabel}
        </Button>
      ) : null}
      <Button
        type="button"
        autoFocus
        onClick={onConnect}
        disabled={buttonsDisabled}
        data-testid="mcp-setup-connect"
      >
        {connectBusy ? 'Connecting…' : primaryLabel}
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
  onClose,
  onConnect,
  onCopyManualConfig,
  onDisconnect,
  onLoadManualConfig,
}: McpSetupDialogProps) {
  const copy = actionCopy(status)
  const connectBusy = busyAction === 'connect'
  const disconnectBusy = busyAction === 'disconnect'
  const buttonsDisabled = busyAction !== null || status === 'checking'

  useEffect(() => {
    if (open) onLoadManualConfig?.()
  }, [open, onLoadManualConfig])

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent showCloseButton={false} className="sm:max-w-[520px]" data-testid="mcp-setup-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck size={18} />
            {copy.title}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm leading-6 text-muted-foreground">
          <p>
            This setup requires Node.js 18+ on PATH and an MCP-compatible desktop tool. Tolaria checks Node.js before writing config so the tool is not left pointing at a broken command.
          </p>
          <p>
            Confirming this action will write or update Tolaria&apos;s single <code className="rounded bg-muted px-1 py-0.5 text-xs">tolaria</code> MCP entry in:
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
            onCopy={onCopyManualConfig}
            snippet={manualConfigSnippet}
          />
          <p>
            Claude Code CLI reads <code className="rounded bg-muted px-1 py-0.5 text-xs">~/.claude.json</code>, Gemini CLI reads <code className="rounded bg-muted px-1 py-0.5 text-xs">~/.gemini/settings.json</code>, Cursor reads <code className="rounded bg-muted px-1 py-0.5 text-xs">~/.cursor/mcp.json</code>, and the generic <code className="rounded bg-muted px-1 py-0.5 text-xs">~/.config/mcp/mcp.json</code> path is picked up by other MCP-compatible tools. Cancel leaves all files untouched, reconnect is idempotent, and disconnect removes Tolaria&apos;s entry again.
          </p>
          <p>
            Gemini CLI needs its own install and sign-in. Use Restore Tolaria AI Guidance when you want a vault-root <code className="rounded bg-muted px-1 py-0.5 text-xs">GEMINI.md</code> compatibility shim that points Gemini back to the shared <code className="rounded bg-muted px-1 py-0.5 text-xs">AGENTS.md</code> instructions without overwriting custom guidance.
          </p>
        </div>

        <McpSetupActions
          buttonsDisabled={buttonsDisabled}
          connectBusy={connectBusy}
          disconnectBusy={disconnectBusy}
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
