import { render, screen } from '@testing-library/react'
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
