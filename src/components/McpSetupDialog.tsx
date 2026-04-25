import { ShieldCheck } from 'lucide-react'
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

export function McpSetupDialog({
  open,
  status,
  busyAction,
  onClose,
  onConnect,
  onDisconnect,
}: McpSetupDialogProps) {
  const copy = actionCopy(status)
  const connectBusy = busyAction === 'connect'
  const disconnectBusy = busyAction === 'disconnect'
  const buttonsDisabled = busyAction !== null || status === 'checking'

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
            Confirming this action will write or update Tolaria&apos;s single <code className="rounded bg-muted px-1 py-0.5 text-xs">tolaria</code> MCP entry in:
          </p>
          <div className="rounded-md border border-border bg-muted/30 px-3 py-3 font-mono text-xs text-foreground">
            <div>~/.claude.json</div>
            <div>~/.claude/mcp.json</div>
            <div>~/.cursor/mcp.json</div>
            <div>~/.config/mcp/mcp.json</div>
            <div>~/.config/opencode/opencode.json</div>
          </div>
          <p>
            Each tool uses its own config format: Claude Code reads <code className="rounded bg-muted px-1 py-0.5 text-xs">~/.claude.json</code>, Cursor reads <code className="rounded bg-muted px-1 py-0.5 text-xs">~/.cursor/mcp.json</code>, the generic <code className="rounded bg-muted px-1 py-0.5 text-xs">~/.config/mcp/mcp.json</code> is picked up by other MCP-compatible tools, and OpenCode reads <code className="rounded bg-muted px-1 py-0.5 text-xs">~/.config/opencode/opencode.json</code>. Cancel leaves all files untouched, reconnect is idempotent, and disconnect removes Tolaria&apos;s entry again.
          </p>
        </div>

        <DialogFooter className="flex-row items-center justify-end gap-2 sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={buttonsDisabled}>
            Cancel
          </Button>
          {copy.secondaryLabel ? (
            <Button
              type="button"
              variant="destructive"
              onClick={onDisconnect}
              disabled={buttonsDisabled}
              data-testid="mcp-setup-disconnect"
            >
              {disconnectBusy ? 'Disconnecting…' : copy.secondaryLabel}
            </Button>
          ) : null}
          <Button
            type="button"
            autoFocus
            onClick={onConnect}
            disabled={buttonsDisabled}
            data-testid="mcp-setup-connect"
          >
            {connectBusy ? 'Connecting…' : copy.primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
