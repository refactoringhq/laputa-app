import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as statusStyles from '../utils/statusStyles'
import { StatusDropdown } from './StatusDropdown'

describe('StatusDropdown extra coverage', () => {
  const onSave = vi.fn()
  const onCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.style.removeProperty('zoom')
    document.documentElement.style.removeProperty('--tolaria-overlay-zoom-factor')
    document.documentElement.style.removeProperty('--tolaria-overlay-zoom-inverse')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makeRect({ bottom, left, right, top }: { bottom: number; left: number; right: number; top: number }): DOMRect {
    return {
      bottom,
      height: bottom - top,
      left,
      right,
      top,
      width: right - left,
      x: left,
      y: top,
      toJSON: () => ({}),
    } as DOMRect
  }

  it('wraps keyboard navigation to the create option and scrolls highlighted items into view', () => {
    const scrollSpy = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => {})

    render(
      <StatusDropdown
        value="Active"
        vaultStatuses={['Doing']}
        onSave={onSave}
        onCancel={onCancel}
      />,
    )

    const input = screen.getByTestId('status-search-input')
    fireEvent.change(input, { target: { value: 'Needs Review' } })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(scrollSpy).toHaveBeenCalled()
    expect(onSave).toHaveBeenCalledWith('Needs Review')

    scrollSpy.mockRestore()
  })

  it('opens color pickers and persists the selected accent color', () => {
    const setStatusColorSpy = vi.spyOn(statusStyles, 'setStatusColor')

    render(
      <StatusDropdown
        value="Active"
        vaultStatuses={['Active']}
        onSave={onSave}
        onCancel={onCancel}
      />,
    )

    fireEvent.click(screen.getByTestId('status-color-swatch-Active'))
    expect(screen.getByTestId('color-picker-Active')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('color-option-green'))

    expect(setStatusColorSpy).toHaveBeenCalledWith('Active', 'green')
    expect(screen.queryByTestId('color-picker-Active')).not.toBeInTheDocument()
  })

  it('positions the popover in viewport coordinates when the app is zoomed', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1600)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(900)
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(makeRect({ left: 1170, right: 1261, top: 650, bottom: 681.2 }))
    document.documentElement.style.setProperty('--tolaria-overlay-zoom-factor', '1.3')

    render(
      <StatusDropdown
        value="Active"
        vaultStatuses={['Active']}
        onSave={onSave}
        onCancel={onCancel}
      />,
    )

    const popover = screen.getByTestId('status-dropdown-popover')
    expect(popover.style.left).toBe('762px')
    expect(popover.style.top).toBe('528px')

    rectSpy.mockRestore()
  })
})
