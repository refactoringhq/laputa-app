import { act, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../types'
import { bindVaultConfigStore, resetVaultConfigStore } from '../utils/vaultConfigStore'
import {
  EditorTestHarness as Editor,
  defaultProps,
  flushEditorSwapWork,
  mockEditor,
  mockEntry,
  render,
  resetEditorTestState,
} from './Editor.helpers.test'

const NOTE_A_ENTRY: VaultEntry = {
  ...mockEntry,
  path: '/vault/probe-a-self.md',
  filename: 'probe-a-self.md',
  title: 'Probe A self',
}

const NOTE_A = {
  entry: NOTE_A_ENTRY,
  content: '---\ntype: Note\nprobe_value: hello\n---\n\n# Probe A self\n\nAlpha body.\n',
}

const SHEET_ENTRY: VaultEntry = {
  ...mockEntry,
  path: '/vault/probe-sheet.md',
  filename: 'probe-sheet.md',
  title: 'Probe sheet',
  display: 'sheet',
}

const SHEET_CONTENT = '---\ntype: Note\n_display: sheet\n---\nName,Wert\nx,42\n'
const SHEET_TAB = { entry: SHEET_ENTRY, content: SHEET_CONTENT }

/**
 * A durable block (html/mermaid/tldraw/callout/attachment) in the stale rich
 * editor document is what used to force serialization even when there was no
 * pending editor change to flush.
 */
const STALE_NOTE_A_DOCUMENT = [
  {
    id: 'h1',
    type: 'heading',
    props: { level: 1 },
    content: [{ type: 'text', text: 'Probe A self' }],
    children: [],
  },
  {
    id: 'html-1',
    type: 'htmlBlock',
    props: { height: '80', html: '<p>A: {{probe_value}}</p>', scripts: 'blocked' },
    content: [],
    children: [],
  },
]

function bindEmptyVaultConfig() {
  resetVaultConfigStore()
  bindVaultConfigStore(
    {
      zoom: null,
      view_mode: null,
      editor_mode: null,
      tag_colors: null,
      status_colors: null,
      property_display_modes: null,
      inbox: null,
    },
    vi.fn(),
  )
}

describe('sheet notes and the shared rich editor', () => {
  beforeEach(() => {
    resetEditorTestState()
    bindEmptyVaultConfig()
    // Sheets are deliberately never swapped into the rich editor, so while a
    // sheet is active the shared editor still holds the previous note.
    mockEditor.document = STALE_NOTE_A_DOCUMENT
  })

  it('does not write the previously viewed note body into a sheet note', async () => {
    const rawToggleRef = { current: (() => {}) as () => void | Promise<void> }
    const flushPendingRawContentRef = { current: null as ((path: string) => void) | null }
    const onContentChange = vi.fn()

    const props = {
      ...defaultProps,
      tabs: [NOTE_A, SHEET_TAB],
      entries: [NOTE_A_ENTRY, SHEET_ENTRY],
      onContentChange,
      rawToggleRef,
      flushPendingRawContentRef,
    }

    const { rerender } = render(<Editor {...props} activeTabPath={NOTE_A_ENTRY.path} />)
    await flushEditorSwapWork()

    rerender(<Editor {...props} activeTabPath={SHEET_ENTRY.path} />)
    await flushEditorSwapWork()
    expect(screen.getByTestId('sheet-editor')).toHaveAttribute('data-path', SHEET_ENTRY.path)

    await act(async () => {
      await rawToggleRef.current()
    })
    await flushEditorSwapWork()

    // The raw buffer must hold the sheet's own CSV, not note A's body.
    const rawText = screen.getByTestId('raw-editor-codemirror').textContent ?? ''
    expect(rawText).toContain('Name,Wert')
    expect(rawText).not.toContain('Probe A self')

    // Any save or note action while raw mode is open flushes that buffer to disk.
    await act(async () => {
      flushPendingRawContentRef.current?.(SHEET_ENTRY.path)
    })

    await act(async () => {
      await rawToggleRef.current()
    })
    await flushEditorSwapWork()

    expect(onContentChange).not.toHaveBeenCalledWith(
      SHEET_ENTRY.path,
      expect.stringContaining('Probe A self'),
    )
  })
})
