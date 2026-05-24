import { cn } from '@/lib/utils'
import type { WorkspaceIdentity } from '../types'

interface WorkspaceInitialsBadgeProps {
  ariaLabel?: string
  className?: string
  testId?: string
  workspace?: WorkspaceIdentity | null
}

export function WorkspaceInitialsBadge({ ariaLabel, className, testId, workspace }: WorkspaceInitialsBadgeProps) {
  if (!workspace) return null

  const accentColor = workspace.color ? `var(--accent-${workspace.color})` : 'var(--muted-foreground)'

  return (
    <span
      className={cn(
        'inline-flex h-[16px] min-w-[18px] items-center justify-center rounded-sm border bg-transparent px-1 align-middle text-[9px] font-semibold opacity-75',
        className,
      )}
      style={{ borderColor: accentColor, color: accentColor }}
      title={`${workspace.label} (${workspace.alias})`}
      aria-label={ariaLabel ?? `Workspace ${workspace.label}`}
      data-testid={testId}
    >
      <span className="block h-[16px] leading-[16px]">{workspace.shortLabel}</span>
    </span>
  )
}
