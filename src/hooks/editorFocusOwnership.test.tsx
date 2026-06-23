import { fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { useGuardedWorkbookFocus } from '../components/sheet-editor/useGuardedWorkbookFocus'
import { useEditorFocusScope, useInspectorFocusBoundary } from './editorFocusOwnership'

function FocusOwnershipHarness() {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const inspectorRef = useRef<HTMLElement | null>(null)
  useEditorFocusScope(editorRef)
  useInspectorFocusBoundary(inspectorRef)

  return (
    <>
      <div ref={editorRef} data-testid="editor-scope">
        <button data-testid="editor-focus-target">Editor target</button>
      </div>
      <aside ref={inspectorRef}>
        <input aria-label="Property field" />
      </aside>
    </>
  )
}

function WorkbookFocusGuard() {
  const sheetElementRef = useRef<HTMLDivElement | null>(null)
  const sheetFocusSuppressedRef = useRef(false)
  const sheetKeyboardCapturedRef = useRef(true)
  useGuardedWorkbookFocus({
    sheetElementRef,
    sheetFocusSuppressedRef,
    sheetKeyboardCapturedRef,
  })

  return <div ref={sheetElementRef} data-testid="sheet-scope" />
}

function SharedFocusGuardLifecycleHarness() {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const [showWorkbookGuard, setShowWorkbookGuard] = useState(true)
  useEditorFocusScope(editorRef)

  return (
    <>
      <div ref={editorRef} data-testid="editor-scope" />
      {showWorkbookGuard && <WorkbookFocusGuard />}
      <button type="button" onClick={() => setShowWorkbookGuard(false)}>
        Unmount workbook guard
      </button>
    </>
  )
}

describe('editor focus ownership', () => {
  it('blocks editor focus after properties take focus ownership', () => {
    render(<FocusOwnershipHarness />)
    const propertyField = screen.getByLabelText('Property field')
    propertyField.focus()

    screen.getByTestId('editor-focus-target').focus()

    expect(document.activeElement).toBe(propertyField)
  })

  it('allows editor focus after the user points back into the editor', () => {
    render(<FocusOwnershipHarness />)
    const propertyField = screen.getByLabelText('Property field')
    const editorTarget = screen.getByTestId('editor-focus-target')
    propertyField.focus()

    fireEvent.pointerDown(editorTarget)
    editorTarget.focus()

    expect(document.activeElement).toBe(editorTarget)
  })

  it('restores properties focus when editor focus bypasses the patched focus method', () => {
    const nativeFocus = HTMLElement.prototype.focus
    render(<FocusOwnershipHarness />)
    const propertyField = screen.getByLabelText('Property field')
    propertyField.focus()

    nativeFocus.call(screen.getByTestId('editor-focus-target'))

    expect(document.activeElement).toBe(propertyField)
  })

  it('keeps the editor guard installed after the workbook guard unmounts', () => {
    const nativeDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'focus')
    const nativeFocus = HTMLElement.prototype.focus
    const view = render(<SharedFocusGuardLifecycleHarness />)

    expect(HTMLElement.prototype.focus).not.toBe(nativeFocus)

    fireEvent.click(screen.getByRole('button', { name: 'Unmount workbook guard' }))
    const focusAfterWorkbookUnmount = HTMLElement.prototype.focus
    view.unmount()
    if (nativeDescriptor) Object.defineProperty(HTMLElement.prototype, 'focus', nativeDescriptor)

    expect(focusAfterWorkbookUnmount).not.toBe(nativeFocus)
    expect(HTMLElement.prototype.focus).toBe(nativeFocus)
  })
})
