import type { ComponentProps } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SidebarNavArrows } from './SidebarNavArrows'

const { trackNavigationHistoryButtonClickedMock } = vi.hoisted(() => ({
  trackNavigationHistoryButtonClickedMock: vi.fn(),
}))

vi.mock('../../lib/productAnalytics', () => ({
  trackNavigationHistoryButtonClicked: trackNavigationHistoryButtonClickedMock,
}))

function renderArrows(props: Partial<ComponentProps<typeof SidebarNavArrows>> = {}) {
  const defaults = {
    canGoBack: true,
    canGoForward: true,
    onGoBack: vi.fn(),
    onGoForward: vi.fn(),
  }
  const merged = { ...defaults, ...props }
  return {
    ...render(
      <TooltipProvider>
        <SidebarNavArrows {...merged} />
      </TooltipProvider>,
    ),
    props: merged,
  }
}

describe('SidebarNavArrows', () => {
  beforeEach(() => {
    trackNavigationHistoryButtonClickedMock.mockClear()
  })

  it('renders back and forward buttons with default English labels', () => {
    renderArrows()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Forward' })).toBeInTheDocument()
  })

  it('localizes button labels', () => {
    renderArrows({ locale: 'zh-CN' })
    expect(screen.getByRole('button', { name: '返回' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '前进' })).toBeInTheDocument()
  })

  it('calls and tracks back navigation when back is clicked', () => {
    const { props } = renderArrows()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(props.onGoBack).toHaveBeenCalledOnce()
    expect(trackNavigationHistoryButtonClickedMock).toHaveBeenCalledWith('back')
  })

  it('calls and tracks forward navigation when forward is clicked', () => {
    const { props } = renderArrows()
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }))
    expect(props.onGoForward).toHaveBeenCalledOnce()
    expect(trackNavigationHistoryButtonClickedMock).toHaveBeenCalledWith('forward')
  })

  it('disables back navigation when history is unavailable', () => {
    const { props } = renderArrows({ canGoBack: false })
    const back = screen.getByRole('button', { name: 'Back' })
    expect(back).toBeDisabled()
    fireEvent.click(back)
    expect(props.onGoBack).not.toHaveBeenCalled()
    expect(trackNavigationHistoryButtonClickedMock).not.toHaveBeenCalled()
  })

  it('disables forward navigation when future history is unavailable', () => {
    const { props } = renderArrows({ canGoForward: false })
    const forward = screen.getByRole('button', { name: 'Forward' })
    expect(forward).toBeDisabled()
    fireEvent.click(forward)
    expect(props.onGoForward).not.toHaveBeenCalled()
    expect(trackNavigationHistoryButtonClickedMock).not.toHaveBeenCalled()
  })

  it('marks both buttons as non-drag controls', () => {
    renderArrows()
    expect(screen.getByRole('button', { name: 'Back' })).toHaveAttribute('data-no-drag')
    expect(screen.getByRole('button', { name: 'Forward' })).toHaveAttribute('data-no-drag')
  })
})
