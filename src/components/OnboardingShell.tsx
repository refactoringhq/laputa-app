import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { cn } from '@/lib/utils'
import { useDragRegion } from '../hooks/useDragRegion'

interface OnboardingShellProps {
  children: ReactNode
  className?: string
  contentClassName?: string
  contentStyle?: CSSProperties
  style?: CSSProperties
  testId?: string
}

export function OnboardingShell({
  children,
  className,
  contentClassName,
  contentStyle,
  style,
  testId,
}: OnboardingShellProps) {
  type DragRegionResult = ReturnType<typeof useDragRegion<HTMLDivElement>> & {
    dragRegionRef?: RefObject<HTMLDivElement | null>
  }
  const { dragRegionRef, onMouseDown } = useDragRegion<HTMLDivElement>() as DragRegionResult
  const fallbackDragRegionRef = useRef<HTMLDivElement>(null)
  const shellRef = dragRegionRef ?? fallbackDragRegionRef

  useEffect(() => {
    if (dragRegionRef) return
    const shell = fallbackDragRegionRef.current
    if (!shell) return

    shell.addEventListener('mousedown', onMouseDown)
    return () => shell.removeEventListener('mousedown', onMouseDown)
  }, [dragRegionRef, onMouseDown])

  return (
    <div
      ref={shellRef}
      className={cn('flex h-full w-full items-center justify-center px-6 py-8', className)}
      style={style}
      data-testid={testId}
    >
      <div className={contentClassName} style={contentStyle} data-no-drag>
        {children}
      </div>
    </div>
  )
}
