import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'
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
})
