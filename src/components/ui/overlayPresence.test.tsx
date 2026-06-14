import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip'
import { useZoom } from '@/hooks/useZoom'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './popover'

const PRESENCE_ANIMATION_CLASS_PARTS = [
  'animate-',
  'fade-',
  'zoom-in-',
  'zoom-out-',
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
  beforeEach(() => {
    document.documentElement.style.removeProperty('--tolaria-overlay-zoom-factor')
    document.documentElement.style.removeProperty('--tolaria-overlay-zoom-inverse')
  })

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

  it('publishes zoom variables for overlay portal positioning and visual scale', () => {
    const { result } = renderHook(() => useZoom())

    act(() => {
      result.current.zoomIn()
    })

    expect(document.documentElement.style.getPropertyValue('--tolaria-overlay-zoom-factor')).toBe(String(110 / 100))
    expect(document.documentElement.style.getPropertyValue('--tolaria-overlay-zoom-inverse')).toBe(String(100 / 110))
  })

  it('keeps tooltip positioning and arrow geometry in the same Radix shell', async () => {
    document.documentElement.style.setProperty('--tolaria-overlay-zoom-factor', '1.4')
    document.documentElement.style.setProperty('--tolaria-overlay-zoom-inverse', String(1 / 1.4))

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

    const positionShell = document.querySelector('[data-slot="tooltip-content"]') as HTMLElement
    const positionWrapper = positionShell.parentElement as HTMLElement
    expect(positionWrapper).toHaveAttribute('data-radix-popper-content-wrapper')
    await waitFor(() => {
      expect(positionWrapper.style.transform).toContain('translate')
    })
    expect(positionWrapper).not.toHaveAttribute('data-tolaria-tooltip-position-zoom')
    expect(positionWrapper.style.getPropertyValue('--tolaria-tooltip-wrapper-zoom')).toBe('')
    expect(positionWrapper.style.getPropertyValue('zoom')).toBe('')
    expect(positionShell.className).not.toContain('[zoom:var(--tolaria-overlay-zoom-inverse,1)]')
    expect(positionShell.className).not.toContain('[zoom:var(--tolaria-overlay-zoom-factor,1)]')
    expect(document.querySelector('[data-slot="tooltip-visual-scale"]')).not.toBeInTheDocument()
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
