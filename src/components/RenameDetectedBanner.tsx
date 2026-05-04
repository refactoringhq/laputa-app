import { ArrowsClockwise } from '@phosphor-icons/react'

export interface DetectedRename {
  old_path: string
  new_path: string
}

interface RenameDetectedBannerProps {
  renames: DetectedRename[]
  onUpdate: () => void
  onDismiss: () => void
}

export function RenameDetectedBanner({ renames, onUpdate, onDismiss }: RenameDetectedBannerProps) {
  if (renames.length === 0) return null

  const count = renames.length
  return (
    <div className="flex flex-col border-b border-border bg-accent/50 px-4 py-2 text-[13px]">
      <div className="flex items-center gap-3">
        <ArrowsClockwise size={16} className="shrink-0 text-accent-foreground" />
        <span className="flex-1 text-foreground">
          {count} file{count !== 1 ? 's' : ''} renamed outside Tolaria. Update wikilinks?
        </span>
      <button
        className="shrink-0 cursor-pointer rounded-md bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        onClick={onUpdate}
      >
        Update wikilinks
      </button>
      <button
        className="shrink-0 cursor-pointer rounded-md border border-border bg-transparent px-3 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted"
        onClick={onDismiss}
      >
        Ignore
      </button>
      </div>
      <div className="mt-2 max-h-32 overflow-y-auto text-[12px] text-muted-foreground">
        {renames.map((rename, index) => (
          <div key={index} className="truncate">
            <span className="text-foreground">{rename.old_path}</span>
            <span className="mx-2">→</span>
            <span className="text-foreground">{rename.new_path}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
