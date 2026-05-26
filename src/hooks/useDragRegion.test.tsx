import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDragRegion } from './useDragRegion'

const { invoke, startDragging } = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  startDragging: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ startDragging }),
}))

function DragRegionHarness() {
  const { dragRegionRef } = useDragRegion<HTMLDivElement>()

  return (
    <div data-testid="drag-surface" ref={dragRegionRef}>
      <div data-testid="no-drag-card" data-no-drag>
        <button type="button">Action</button>
      </div>
      <div role="menu" aria-label="Note actions">
        <button type="button" role="menuitem">Delete this note</button>
      </div>
    </div>
  )
}

describe('useDragRegion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts dragging from the background surface', () => {
    render(<DragRegionHarness />)

    fireEvent.mouseDown(screen.getByTestId('drag-surface'), { button: 0 })

    expect(startDragging).toHaveBeenCalledOnce()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('runs the native title-bar action on a double-click', () => {
    render(<DragRegionHarness />)

    fireEvent.mouseDown(screen.getByTestId('drag-surface'), { button: 0, detail: 2 })

    expect(invoke).toHaveBeenCalledWith('perform_current_window_titlebar_double_click')
    expect(startDragging).not.toHaveBeenCalled()
  })

  it('does not start dragging from no-drag containers', () => {
    render(<DragRegionHarness />)

    fireEvent.mouseDown(screen.getByTestId('no-drag-card'), { button: 0 })

    expect(startDragging).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not start dragging from interactive descendants', () => {
    render(<DragRegionHarness />)

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Action' }), { button: 0 })

    expect(startDragging).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not start dragging from menu items rendered inside drag surfaces', () => {
    render(<DragRegionHarness />)

    fireEvent.mouseDown(screen.getByRole('menuitem', { name: 'Delete this note' }), { button: 0 })

    expect(startDragging).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('ignores non-primary mouse buttons', () => {
    render(<DragRegionHarness />)

    fireEvent.mouseDown(screen.getByTestId('drag-surface'), { button: 1 })

    expect(startDragging).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })
})
