import type { ComponentProps } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SidebarTitleBar } from './SidebarSections'

function renderTitleBar(overrides: Partial<ComponentProps<typeof SidebarTitleBar>> = {}) {
  const props = {
    canGoBack: true,
    canGoForward: true,
    onGoBack: vi.fn(),
    onGoForward: vi.fn(),
    onCollapse: vi.fn(),
    ...overrides,
  }
  return {
    ...render(<SidebarTitleBar {...props} />),
    props,
  }
}

describe('SidebarTitleBar', () => {
  it('renders navigation arrows and the collapse button together', () => {
    renderTitleBar()
    expect(screen.getByTestId('sidebar-nav-arrows')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Forward' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument()
  })

  it('forwards back and forward clicks', () => {
    const { props } = renderTitleBar()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }))
    expect(props.onGoBack).toHaveBeenCalledOnce()
    expect(props.onGoForward).toHaveBeenCalledOnce()
  })

  it('keeps the collapse button clickable and outside the drag region', () => {
    const { props } = renderTitleBar()
    const collapse = screen.getByRole('button', { name: 'Collapse sidebar' })
    fireEvent.click(collapse)
    expect(props.onCollapse).toHaveBeenCalledOnce()
    expect(collapse).toHaveAttribute('data-no-drag')
  })

  it('hides collapse when unavailable but keeps history controls visible', () => {
    renderTitleBar({ onCollapse: undefined })
    expect(screen.getByTestId('sidebar-nav-arrows')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).not.toBeInTheDocument()
  })
})
