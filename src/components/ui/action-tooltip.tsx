import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface ActionTooltipCopy {
  label: string
  shortcut?: string
}

interface ActionTooltipProps {
  copy: ActionTooltipCopy
  children: ReactNode
  className?: string
  contentTestId?: string
  side?: ComponentProps<typeof TooltipContent>['side']
  align?: ComponentProps<typeof TooltipContent>['align']
  sideOffset?: number
}

export function ActionTooltip({
  copy,
  children,
  className,
  contentTestId,
  side = 'top',
  align = 'center',
  sideOffset = 6,
}: ActionTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        data-align={align}
        data-testid={contentTestId}
        className={cn('px-2.5 py-2', className)}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="min-w-0 flex-1 text-[11px] font-medium leading-tight">{copy.label}</span>
          {copy.shortcut && (
            <span className="shrink-0 rounded border border-background/20 bg-background/10 px-1.5 py-0.5 font-mono text-[10px] leading-none text-background/80">
              {copy.shortcut}
            </span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
