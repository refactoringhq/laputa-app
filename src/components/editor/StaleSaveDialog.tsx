import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

interface StaleSaveDialogProps {
  open: boolean
  notePath: string | null
  onReloadFromDisk: () => void
  onDuplicateLocalDraft: () => void
  onCancel: () => void
}

export function StaleSaveDialog({
  open,
  notePath,
  onReloadFromDisk,
  onDuplicateLocalDraft,
  onCancel,
}: StaleSaveDialogProps) {
  const filename = notePath?.split('/').pop() ?? 'this note'

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <DialogTitle>File changed on disk</DialogTitle>
              <DialogDescription className="mt-1">
                <strong>{filename}</strong> was modified outside the editor. Saving now would overwrite those changes.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="flex flex-col gap-2 py-3">
          <Button
            variant="default"
            onClick={onReloadFromDisk}
            className="w-full justify-start"
            data-testid="stale-save-reload"
          >
            Reload from disk
            <span className="ml-auto text-xs text-muted-foreground">Discard your local edits</span>
          </Button>
          <Button
            variant="outline"
            onClick={onDuplicateLocalDraft}
            className="w-full justify-start"
            data-testid="stale-save-duplicate"
          >
            Save as recovered copy
            <span className="ml-auto text-xs text-muted-foreground">Keep both versions</span>
          </Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
