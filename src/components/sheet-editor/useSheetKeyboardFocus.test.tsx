import { act, render, screen } from '@testing-library/react'
import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSheetKeyboardFocus } from './useSheetKeyboardFocus'
import { useGuardedWorkbookFocus } from './useGuardedWorkbookFocus'
import type {
  FormulaAutocompleteState,
  SheetWikilinkAutocompleteState,
} from './sheetEditorHelpers'
import type { SheetContextMenuState } from '../../utils/sheetContextMenuState'

type SheetKeyboardFocusRuntime = ReturnType<typeof useSheetKeyboardFocus>

interface SheetKeyboardFocusHarnessProps {
  dialogOpen?: boolean
  runtimeRef: MutableRefObject<SheetKeyboardFocusRuntime | null>
  scheduleSelectionChromePatch: () => void
}

function SheetKeyboardFocusHarness({
  dialogOpen = false,
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
  useGuardedWorkbookFocus({
    onWorkbookFocusBlocked: runtime.releaseSheetKeyboard,
    sheetElementRef,
    sheetFocusSuppressedRef: runtime.sheetFocusSuppressedRef,
    sheetKeyboardCapturedRef: runtime.sheetKeyboardCapturedRef,
  })

  useEffect(() => {
    runtimeRef.current = runtime
  }, [runtime, runtimeRef])

  return (
    <>
      <div ref={sheetElementRef} data-keyboard-active={runtime.sheetKeyboardActive} data-testid="sheet">
        <div className="sheet-container" data-testid="workbook" tabIndex={0} />
      </div>
      <input aria-label="Properties input" />
      {dialogOpen && (
        <div role="dialog" aria-modal="true">
          <input aria-label="Rename filename" />
        </div>
      )}
    </>
  )
}

function renderSheetKeyboardFocusHarness({ dialogOpen = false }: { dialogOpen?: boolean } = {}) {
  const runtimeRef: MutableRefObject<SheetKeyboardFocusRuntime | null> = { current: null }
  const scheduleSelectionChromePatch = vi.fn()
  render(
    <SheetKeyboardFocusHarness
      dialogOpen={dialogOpen}
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

  it('starts passive and blocks workbook autofocus until sheet capture', () => {
    const { runtime } = renderSheetKeyboardFocusHarness()
    const workbook = screen.getByTestId('workbook')

    workbook.focus()

    expect(document.activeElement).toBe(document.body)
    expect(screen.getByTestId('sheet')).toHaveAttribute('data-keyboard-active', 'false')

    act(() => {
      runtime?.captureSheetKeyboard()
    })
    workbook.focus()

    expect(document.activeElement).toBe(workbook)
    expect(screen.getByTestId('sheet')).toHaveAttribute('data-keyboard-active', 'true')
  })

  it('restores workbook focus when focus has not moved into an app panel', () => {
    vi.useFakeTimers()
    const { runtime, scheduleSelectionChromePatch } = renderSheetKeyboardFocusHarness()

    act(() => {
      runtime?.restoreSheetKeyboardFocus()
      vi.runOnlyPendingTimers()
    })

    expect(document.activeElement).toBe(screen.getByTestId('workbook'))
    expect(screen.getByTestId('sheet')).toHaveAttribute('data-keyboard-active', 'true')
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
    expect(screen.getByTestId('sheet')).toHaveAttribute('data-keyboard-active', 'false')
    expect(scheduleSelectionChromePatch).not.toHaveBeenCalled()
  })

  it('does not steal focus from a dialog input after a sheet focus request', () => {
    vi.useFakeTimers()
    const { runtime, scheduleSelectionChromePatch } = renderSheetKeyboardFocusHarness({ dialogOpen: true })
    const renameInput = screen.getByLabelText('Rename filename')

    act(() => {
      renameInput.focus()
      runtime?.restoreSheetKeyboardFocus()
      vi.runOnlyPendingTimers()
    })

    expect(document.activeElement).toBe(renameInput)
    expect(screen.getByTestId('sheet')).toHaveAttribute('data-keyboard-active', 'false')
    expect(scheduleSelectionChromePatch).not.toHaveBeenCalled()
  })
})
