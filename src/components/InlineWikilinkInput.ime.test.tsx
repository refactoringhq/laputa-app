import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../types'
import { WikilinkChatInput } from './WikilinkChatInput'

function ControlledComposer({ onDraftChange }: { onDraftChange: (value: string) => void }) {
  const [value, setValue] = useState('')
  const handleChange = (nextValue: string) => {
    onDraftChange(nextValue)
    setValue(nextValue)
  }

  return <WikilinkChatInput entries={[] as VaultEntry[]} value={value} onChange={handleChange} onSend={vi.fn()} />
}

function setSelection(editor: HTMLElement, offset: number) {
  const selection = window.getSelection()
  if (!selection) return

  const targetNode = editor.firstChild ?? editor
  const range = document.createRange()
  range.setStart(targetNode, Math.min(offset, targetNode.textContent?.length ?? 0))
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

function lateCompositionCommit(editor: HTMLElement, text: string) {
  const event = new Event('beforeinput', { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    data: { value: text.at(-1) },
    inputType: { value: 'insertText' },
    isComposing: { value: false },
  })
  fireEvent(editor, event)
  editor.textContent = text
  setSelection(editor, text.length)
  fireEvent.input(editor)
  return event
}

describe('InlineWikilinkInput Korean IME settlement', () => {
  it('does not reconcile the composer before a late native commit reaches the original editor', async () => {
    const onDraftChange = vi.fn()
    render(<ControlledComposer onDraftChange={onDraftChange} />)
    const editor = screen.getByTestId('agent-input')

    editor.focus()
    fireEvent.compositionStart(editor)
    editor.textContent = '안녕하세'
    setSelection(editor, '안녕하세'.length)
    fireEvent.input(editor)
    fireEvent.compositionEnd(editor)

    await act(async () => Promise.resolve())

    expect(onDraftChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('agent-input')).toBe(editor)

    const commitEvent = lateCompositionCommit(editor, '안녕하세요')

    expect(commitEvent.defaultPrevented).toBe(false)
    await waitFor(() => expect(onDraftChange).toHaveBeenLastCalledWith('안녕하세요'))
    expect(screen.getByTestId('agent-input').textContent).toBe('안녕하세요')
  })
})
