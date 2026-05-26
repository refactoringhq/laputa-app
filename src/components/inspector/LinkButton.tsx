import type { ComponentType, SVGAttributes } from 'react'
import { X } from '@phosphor-icons/react'
import { NoteTitleIcon } from '../NoteTitleIcon'

export function StatusSuffix({ isArchived }: { isArchived: boolean }) {
  if (isArchived) return <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.8 }}>(archived)</span>
  return null
}

export function LinkButton({ label, noteIcon, typeColor, bgColor, isArchived, onClick, onRemove, title, TypeIcon }: {
  label: string
  noteIcon?: string | null
  typeColor: string
  bgColor?: string
  isArchived: boolean
  onClick: () => void
  onRemove?: () => void
  title?: string
  TypeIcon: ComponentType<SVGAttributes<SVGSVGElement>>
}) {
  const isDimmed = isArchived
  const color = isDimmed ? 'var(--muted-foreground)' : typeColor
  return (
    <span
      className={`group/link flex w-full min-w-0 items-center justify-between gap-2${bgColor ? ' ring-inset hover:ring-1 hover:ring-current' : ' hover:opacity-80'}`}
      style={{
        background: isDimmed ? 'var(--muted)' : (bgColor ?? 'transparent'),
        color, borderRadius: 6, padding: bgColor ? '6px 10px' : '4px 0',
        fontSize: 12, fontWeight: 500, opacity: isDimmed ? 0.7 : 1,
      }}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 truncate border-0 bg-transparent p-0 text-left text-[inherit]"
        onClick={onClick}
        title={title}
      >
        <NoteTitleIcon icon={noteIcon} size={14} />
        {label}
        <StatusSuffix isArchived={isArchived} />
      </button>
      <span className="flex items-center gap-1.5 shrink-0">
        {onRemove && (
          <button
            type="button"
            className="flex items-center border-0 bg-transparent p-0 text-[inherit] opacity-0 transition-opacity group-hover/link:opacity-100"
            onClick={onRemove}
            title="Remove from relation"
            data-testid="remove-relation-ref"
          >
            <X size={14} />
          </button>
        )}
        <TypeIcon width={14} height={14} className="shrink-0" style={{ color, opacity: 0.5 }} />
      </span>
    </span>
  )
}
