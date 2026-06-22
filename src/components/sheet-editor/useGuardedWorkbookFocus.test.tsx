import { fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { useGuardedWorkbookFocus } from './useGuardedWorkbookFocus'

function GuardedWorkbookFocusHarness({
  captured = false,
  replaceable = false,
  suppressed = false,
}: {
  captured?: boolean
  replaceable?: boolean
  suppressed?: boolean
}) {
  const [rootVersion, setRootVersion] = useState(0)
  const sheetElementRef = useRef<HTMLDivElement | null>(null)
  const sheetFocusSuppressedRef = useRef(suppressed)
  const sheetKeyboardCapturedRef = useRef(captured)

  useGuardedWorkbookFocus({ sheetElementRef, sheetFocusSuppressedRef, sheetKeyboardCapturedRef })

  return (
    <>
      <div ref={sheetElementRef} data-testid="sheet">
        <div key={rootVersion} data-testid="workbook-root" tabIndex={0}>
          <div className="sheet-container">
            <button data-testid="workbook-inner-control">Inner control</button>
          </div>
        </div>
      </div>
      {replaceable && <button onClick={() => setRootVersion((version) => version + 1)}>Replace root</button>}
      <input aria-label="Properties input" />
    </>
  )
}

function focusWorkbookRoot() {
  const root = screen.getByTestId('workbook-root')
  root.focus()
  return root
}

describe('useGuardedWorkbookFocus', () => {
  it('allows the workbook to focus itself before another app surface has focus', () => {
    render(<GuardedWorkbookFocusHarness />)

    const root = focusWorkbookRoot()

    expect(document.activeElement).toBe(root)
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
})
