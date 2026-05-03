import { act, render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './popover'
import { useZoom } from '@/hooks/useZoom'

const PRESENCE_ANIMATION_CLASS_PARTS = [
  'animate-',
  'fade-',
  'zoom-',
  'slide-in-from',
]

function expectNoPresenceAnimationClasses(element: HTMLElement) {
  const unstableClasses = element.className
    .split(/\s+/)
    .filter((className) =>
      PRESENCE_ANIMATION_CLASS_PARTS.some((part) => className.includes(part)),
    )

  expect(unstableClasses).toEqual([])
}

describe('overlay presence stability', () => {
  it('keeps tooltip content free of Radix presence animation classes', () => {
    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger asChild>
            <button type="button">Tooltip trigger</button>
          </TooltipTrigger>
          <TooltipContent data-testid="tooltip-content">Tooltip copy</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )

    expectNoPresenceAnimationClasses(screen.getByTestId('tooltip-content'))
  })

  it('compensates tooltip portal coordinates for app-level CSS zoom', () => {
    document.documentElement.style.setProperty('--tolaria-overlay-zoom-compensation', '0.7142857142857143')

    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger asChild>
            <button type="button">Tooltip trigger</button>
          </TooltipTrigger>
          <TooltipContent data-testid="tooltip-content">Tooltip copy</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )

    expect(document.querySelector('[data-slot="tooltip-zoom-compensation"]')).toBeInTheDocument()
  })

  it('publishes inverse zoom for overlay portals', () => {
    const { result } = renderHook(() => useZoom())

    act(() => {
      result.current.zoomIn()
    })

    expect(document.documentElement.style.getPropertyValue('--tolaria-overlay-zoom-compensation')).toBe(String(100 / 110))
  })

  it('keeps popover content free of Radix presence animation classes', () => {
    render(
      <Popover open>
        <PopoverTrigger asChild>
          <button type="button">Popover trigger</button>
        </PopoverTrigger>
        <PopoverContent data-testid="popover-content">Popover copy</PopoverContent>
      </Popover>,
    )

    expectNoPresenceAnimationClasses(screen.getByTestId('popover-content'))
  })
})
