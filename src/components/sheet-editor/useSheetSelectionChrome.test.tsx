import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SheetWorkbookState } from './sheetEditorTypes'
import { useSheetSelectionChrome } from './useSheetSelectionChrome'

const workbook = Object.freeze({}) as SheetWorkbookState

function SelectionChromeHarness() {
  const sheetElementRef = useRef<HTMLDivElement | null>(null)
  useSheetSelectionChrome({
    refreshWorkbook: vi.fn(),
    sheetElementRef,
    workbook,
  })

  return (
    <div ref={sheetElementRef}>
      <div className="sheet-container" data-testid="sheet-container" />
    </div>
  )
}

function createIronCalcFillHandle(): HTMLDivElement {
  const handle = document.createElement('div')
  Object.assign(handle.style, {
    backgroundColor: 'rgb(242, 153, 74)',
    cursor: 'crosshair',
    height: '5px',
    position: 'absolute',
    width: '5px',
  })
  return handle
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useSheetSelectionChrome', () => {
  it('hides a replacement IronCalc fill handle before the next animation frame', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    render(<SelectionChromeHarness />)
    const handle = createIronCalcFillHandle()

    await act(async () => {
      screen.getByTestId('sheet-container').appendChild(handle)
      await Promise.resolve()
    })

    expect(handle.style.visibility).toBe('hidden')
    expect(handle.style.pointerEvents).toBe('none')
  })
})
