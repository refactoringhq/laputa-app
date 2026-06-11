import { render, screen } from '@testing-library/react'
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
    vi.doMock('./tooltip', async () => {
      const React = await import('react')
      return {
        Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
        TooltipContent: () => {
          throw tooltipError
        },
        TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
})
