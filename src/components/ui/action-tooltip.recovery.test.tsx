import { render, screen } from '@testing-library/react'
import { useCallback, useLayoutEffect, useState, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isRecoveredActionTooltipError } from './actionTooltipRecovery'

afterEach(() => {
  vi.doUnmock('./tooltip')
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('ActionTooltip recovery', () => {
  it('keeps the trigger mounted when tooltip content rendering fails', async () => {
    const tooltipError = new Error('tooltip content render failed')
    vi.doMock('./tooltip', () => {
      return {
        Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
        TooltipContent: () => {
          throw tooltipError
        },
        TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
      }
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ActionTooltip } = await import('./action-tooltip')

    render(
      <ActionTooltip copy={{ label: 'Switch editor layout' }}>
        <button type="button">Switch editor layout</button>
      </ActionTooltip>,
    )

    expect(screen.getByRole('button', { name: 'Switch editor layout' })).toBeInTheDocument()
    expect(isRecoveredActionTooltipError(tooltipError)).toBe(true)
    expect(consoleError).toHaveBeenCalled()
  })

  it('keeps failed tooltip content disabled when fallback mounting updates parent state', async () => {
    const tooltipError = new Error('tooltip content render failed')
    vi.doMock('./tooltip', () => {
      return {
        Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
        TooltipContent: () => {
          throw tooltipError
        },
        TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
      }
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ActionTooltip } = await import('./action-tooltip')

    function FallbackButton({ onMount }: { onMount: () => void }) {
      useLayoutEffect(() => {
        onMount()
      }, [onMount])
      return <button type="button">Switch editor layout</button>
    }

    function ParentWithFallbackStateUpdate() {
      const [renderCount, setRenderCount] = useState(0)
      const bumpRenderCount = useCallback(() => {
        setRenderCount((current) => current + 1)
      }, [])

      return (
        <ActionTooltip copy={{ label: `Switch editor layout ${renderCount}` }}>
          <FallbackButton onMount={bumpRenderCount} />
        </ActionTooltip>
      )
    }

    expect(() => render(<ParentWithFallbackStateUpdate />)).not.toThrow(/Maximum update depth/)

    expect(screen.getByRole('button', { name: 'Switch editor layout' })).toBeInTheDocument()
    expect(isRecoveredActionTooltipError(tooltipError)).toBe(true)
    expect(consoleError).toHaveBeenCalled()
  })
})
