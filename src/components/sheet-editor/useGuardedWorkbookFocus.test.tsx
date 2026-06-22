import { fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useGuardedWorkbookFocus } from './useGuardedWorkbookFocus'

const nativeHTMLElementFocus = HTMLElement.prototype.focus

function GuardedWorkbookFocusHarness({
  captured = false,
  dialogOpen = false,
  focusBeforeGuard = false,
  onWorkbookFocusBlocked,
  replaceable = false,
  suppressed = false,
}: {
  captured?: boolean
  dialogOpen?: boolean
  focusBeforeGuard?: boolean
  onWorkbookFocusBlocked?: () => void
  replaceable?: boolean
  suppressed?: boolean
}) {
  const [rootVersion, setRootVersion] = useState(0)
  const sheetElementRef = useRef<HTMLDivElement | null>(null)
  const sheetFocusSuppressedRef = useRef(suppressed)
  const sheetKeyboardCapturedRef = useRef(captured)

  useGuardedWorkbookFocus({
    onWorkbookFocusBlocked,
    sheetElementRef,
    sheetFocusSuppressedRef,
    sheetKeyboardCapturedRef,
  })
  const assignWorkbookRoot = (node: HTMLDivElement | null) => {
    if (node && focusBeforeGuard) nativeHTMLElementFocus.call(node)
  }

  return (
    <>
      <div ref={sheetElementRef} data-testid="sheet">
        <div ref={assignWorkbookRoot} key={rootVersion} data-testid="workbook-root" tabIndex={0}>
          <div className="sheet-container">
            <button data-testid="workbook-inner-control">Inner control</button>
          </div>
        </div>
      </div>
      {replaceable && <button onClick={() => setRootVersion((version) => version + 1)}>Replace root</button>}
      <input aria-label="Properties input" />
      {dialogOpen && (
        <div role="dialog" aria-modal="true">
          <input aria-label="Rename filename" />
        </div>
      )}
    </>
  )
}

function focusWorkbookRoot() {
  const root = screen.getByTestId('workbook-root')
  root.focus()
  return root
}

describe('useGuardedWorkbookFocus', () => {
  it('blocks workbook autofocus before sheet keyboard capture is active', () => {
    render(<GuardedWorkbookFocusHarness />)

    focusWorkbookRoot()

    expect(document.activeElement).toBe(document.body)
  })

  it('blocks workbook autofocus after focus moves into the properties panel', () => {
    render(<GuardedWorkbookFocusHarness />)
    const propertiesInput = screen.getByLabelText('Properties input')
    propertiesInput.focus()

    focusWorkbookRoot()

    expect(document.activeElement).toBe(propertiesInput)
  })

  it('blocks workbook autofocus after sheet focus was released to the page body', () => {
    render(<GuardedWorkbookFocusHarness suppressed />)

    focusWorkbookRoot()

    expect(document.activeElement).toBe(document.body)
  })

  it('releases workbook focus claimed before the guard layout effect runs', () => {
    const onWorkbookFocusBlocked = vi.fn()

    render(
      <GuardedWorkbookFocusHarness
        focusBeforeGuard
        onWorkbookFocusBlocked={onWorkbookFocusBlocked}
        suppressed
      />,
    )

    expect(document.activeElement).toBe(document.body)
    expect(onWorkbookFocusBlocked).toHaveBeenCalledOnce()
  })

  it('blocks workbook autofocus after an outside pointer interaction', () => {
    render(<GuardedWorkbookFocusHarness />)
    const propertiesInput = screen.getByLabelText('Properties input')

    fireEvent.pointerDown(propertiesInput)
    focusWorkbookRoot()

    expect(document.activeElement).toBe(document.body)
  })

  it('keeps blocking workbook autofocus after IronCalc replaces the focus root', () => {
    render(<GuardedWorkbookFocusHarness replaceable />)
    const propertiesInput = screen.getByLabelText('Properties input')

    fireEvent.click(screen.getByRole('button', { name: 'Replace root' }))
    propertiesInput.focus()
    focusWorkbookRoot()

    expect(document.activeElement).toBe(propertiesInput)
  })

  it('blocks autofocus from any inner workbook element while focus belongs to properties', () => {
    render(<GuardedWorkbookFocusHarness />)
    const propertiesInput = screen.getByLabelText('Properties input')
    propertiesInput.focus()

    screen.getByTestId('workbook-inner-control').focus()

    expect(document.activeElement).toBe(propertiesInput)
  })

  it('restores properties focus when workbook focus bypasses the patched focus method', () => {
    const nativeFocus = HTMLElement.prototype.focus
    render(<GuardedWorkbookFocusHarness />)
    const propertiesInput = screen.getByLabelText('Properties input')
    propertiesInput.focus()

    nativeFocus.call(screen.getByTestId('workbook-inner-control'))

    expect(document.activeElement).toBe(propertiesInput)
  })

  it('allows the workbook to reclaim focus while sheet keyboard capture is active', () => {
    render(<GuardedWorkbookFocusHarness captured />)

    const root = focusWorkbookRoot()

    expect(document.activeElement).toBe(root)
  })

  it('blocks captured workbook autofocus while a dialog owns focus', () => {
    render(<GuardedWorkbookFocusHarness captured dialogOpen />)
    const renameInput = screen.getByLabelText('Rename filename')
    renameInput.focus()

    focusWorkbookRoot()

    expect(document.activeElement).toBe(renameInput)
  })

  it('blocks captured workbook autofocus while a dialog is opening', () => {
    render(<GuardedWorkbookFocusHarness captured dialogOpen />)

    const root = focusWorkbookRoot()

    expect(document.activeElement).not.toBe(root)
  })
})
