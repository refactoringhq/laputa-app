import { act, render, screen } from '@testing-library/react'
import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSheetKeyboardFocus } from './useSheetKeyboardFocus'
import type {
  FormulaAutocompleteState,
  SheetWikilinkAutocompleteState,
} from './sheetEditorHelpers'
import type { SheetContextMenuState } from '../../utils/sheetContextMenuState'

type SheetKeyboardFocusRuntime = ReturnType<typeof useSheetKeyboardFocus>

interface SheetKeyboardFocusHarnessProps {
  runtimeRef: MutableRefObject<SheetKeyboardFocusRuntime | null>
  scheduleSelectionChromePatch: () => void
}

function SheetKeyboardFocusHarness({
  runtimeRef,
  scheduleSelectionChromePatch,
}: SheetKeyboardFocusHarnessProps) {
  const sheetElementRef = useRef<HTMLDivElement | null>(null)
  const [formulaAutocomplete, setFormulaAutocomplete] = useState<FormulaAutocompleteState | null>(null)
  const [sheetContextMenu, setSheetContextMenu] = useState<SheetContextMenuState | null>(null)
  const [wikilinkAutocomplete, setWikilinkAutocomplete] = useState<SheetWikilinkAutocompleteState | null>(null)
  void formulaAutocomplete
  void sheetContextMenu
  void wikilinkAutocomplete

  const runtime = useSheetKeyboardFocus({
    scheduleSelectionChromePatch,
    setFormulaAutocomplete,
    setSheetContextMenu,
    setWikilinkAutocomplete,
    sheetElementRef,
  })

  useEffect(() => {
    runtimeRef.current = runtime
  }, [runtime, runtimeRef])

  return (
    <>
      <div ref={sheetElementRef} data-testid="sheet">
        <div className="sheet-container" data-testid="workbook" tabIndex={0} />
      </div>
      <input aria-label="Properties input" />
    </>
  )
}

function renderSheetKeyboardFocusHarness() {
  const runtimeRef: MutableRefObject<SheetKeyboardFocusRuntime | null> = { current: null }
  const scheduleSelectionChromePatch = vi.fn()
  render(
    <SheetKeyboardFocusHarness
      runtimeRef={runtimeRef}
      scheduleSelectionChromePatch={scheduleSelectionChromePatch}
    />,
  )
  expect(runtimeRef.current).not.toBeNull()
  return {
    runtime: runtimeRef.current,
    scheduleSelectionChromePatch,
  }
}

describe('useSheetKeyboardFocus', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('restores workbook focus when focus has not moved into an app panel', () => {
    vi.useFakeTimers()
    const { runtime, scheduleSelectionChromePatch } = renderSheetKeyboardFocusHarness()

    act(() => {
      runtime?.restoreSheetKeyboardFocus()
      vi.runOnlyPendingTimers()
    })

    expect(document.activeElement).toBe(screen.getByTestId('workbook'))
    expect(scheduleSelectionChromePatch).toHaveBeenCalledOnce()
  })

  it('does not steal focus back after focus moves into an app panel', () => {
    vi.useFakeTimers()
    const { runtime, scheduleSelectionChromePatch } = renderSheetKeyboardFocusHarness()
    const propertiesInput = screen.getByLabelText('Properties input')

    act(() => {
      runtime?.restoreSheetKeyboardFocus()
      propertiesInput.focus()
      vi.runOnlyPendingTimers()
    })

    expect(document.activeElement).toBe(propertiesInput)
    expect(scheduleSelectionChromePatch).not.toHaveBeenCalled()
  })
})
