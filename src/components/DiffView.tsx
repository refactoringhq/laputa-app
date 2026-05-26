import { cn } from '@/lib/utils'

interface DiffViewProps {
  diff: string
}

const DIFF_HEADER_PREFIXES = ['diff', 'index', '---', '+++', 'new file']

function classifyDiffLine(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'bg-[var(--diff-added-bg)] text-[var(--diff-added-text)]'
  if (line.startsWith('-') && !line.startsWith('---')) return 'bg-[var(--diff-removed-bg)] text-[var(--diff-removed-text)]'
  if (line.startsWith('@@')) return 'bg-[var(--diff-hunk-bg)] text-primary italic'
  if (DIFF_HEADER_PREFIXES.some((p) => line.startsWith(p))) return 'bg-muted text-muted-foreground font-semibold'
  return 'text-secondary-foreground'
}

function DiffLine({ line, lineNumber }: { line: string; lineNumber: number }) {
  return (
    <div className={cn("flex min-h-[22px] px-4", classifyDiffLine(line))}>
      <span className="w-10 shrink-0 text-right pr-3 text-muted-foreground select-none">{lineNumber}</span>
      <span className="flex-1 whitespace-pre-wrap break-all px-2">{line || '\u00A0'}</span>
    </div>
  )
}

export function DiffView({ diff }: DiffViewProps) {
  if (!diff) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No changes to display
      </div>
    )
  }

  return (
    <div className="font-mono text-[13px] leading-relaxed py-3">
      {diff.split('\n').map((line, i) => (
        <DiffLine key={line} line={line} lineNumber={i + 1} />
      ))}
    </div>
  )
}
