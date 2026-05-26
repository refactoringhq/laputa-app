import { ArrowCounterClockwise } from '@phosphor-icons/react'
import type { GitCommit } from '../../types'

function formatRelativeDate(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000)
  const days = Math.floor((now - timestamp) / 86400)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return months === 1 ? '1mo ago' : `${months}mo ago`
}

export function GitHistoryPanel({ commits, onViewCommitDiff }: { commits: GitCommit[]; onViewCommitDiff?: (commitHash: string) => void }) {
  if (commits.length === 0) return null

  return (
    <div>
      <h4 className="font-mono-overline mb-2 flex items-center gap-1 text-muted-foreground">
        <ArrowCounterClockwise size={12} className="shrink-0" />
        History
      </h4>
      <div className="flex flex-col gap-2.5">
        {commits.map((c) => (
          <div key={c.hash} style={{ borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>
            <button type="button"
              className="mb-0.5 w-full cursor-pointer truncate border-none bg-transparent p-0 text-left text-xs text-primary hover:underline"
              onClick={() => onViewCommitDiff?.(c.hash)}
              title={`View diff for ${c.shortHash}`}
            >
              <span className="font-mono" style={{ fontSize: 11 }}>{c.shortHash}</span>
              {' · '}
              {c.message}
            </button>
            <div className="text-muted-foreground" style={{ fontSize: 10 }}>
              {formatRelativeDate(c.date)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
