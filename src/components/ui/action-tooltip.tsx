import { Component, type ComponentProps, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { markRecoveredActionTooltipError } from './actionTooltipRecovery'

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

interface ActionTooltipBoundaryProps {
  children: ReactNode
  fallback: ReactNode
  resetKey: string
}

interface ActionTooltipBoundaryState {
  failed: boolean
}

class ActionTooltipBoundary extends Component<ActionTooltipBoundaryProps, ActionTooltipBoundaryState> {
  state: ActionTooltipBoundaryState = { failed: false }

  static getDerivedStateFromError(): ActionTooltipBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    markRecoveredActionTooltipError(error)
  }

  componentDidUpdate(previousProps: ActionTooltipBoundaryProps) {
    if (previousProps.resetKey === this.props.resetKey || !this.state.failed) return
    this.setState({ failed: false })
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
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
  const resetKey = `${copy.label}\n${copy.shortcut ?? ''}`

  return (
    <ActionTooltipBoundary fallback={children} resetKey={resetKey}>
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
    </ActionTooltipBoundary>
  )
}
