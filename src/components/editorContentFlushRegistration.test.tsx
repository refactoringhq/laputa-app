import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useRegisterEditorContentFlushes } from './editorContentFlushRegistration'

function renderFlushRegistration(options: {
  activeTab: Parameters<typeof useRegisterEditorContentFlushes>[0]['activeTab']
  flushPendingEditorChange: () => boolean
  sheetFlushRef?: { current: ((path: string) => void) | null }
}) {
  const flushPendingEditorContentRef = { current: null as ((path: string) => void) | null }
  renderHook(() => useRegisterEditorContentFlushes({
    activeTab: options.activeTab,
    flushPendingEditorChange: options.flushPendingEditorChange,
    flushPendingEditorContentRef,
    sheetFlushRef: options.sheetFlushRef,
    rawLatestContentRef: { current: null },
    rawMode: false,
  }))
  return flushPendingEditorContentRef
}

describe('useRegisterEditorContentFlushes', () => {
  it('flushes sheets through the sheet editor without serializing BlockNote content', () => {
    const flushRichEditor = vi.fn(() => true)
    const flushSheet = vi.fn()
    const sheetFlushRef = { current: flushSheet as ((path: string) => void) | null }
    const flushPendingEditorContentRef = renderFlushRegistration({
      activeTab: {
        entry: { path: '/vault/model.md', display: 'sheet' },
        content: '---\n_display: sheet\n---\nMetric,January\nRevenue,1200',
      },
      flushPendingEditorChange: flushRichEditor,
      sheetFlushRef,
    })

    act(() => {
      flushPendingEditorContentRef.current?.('/vault/model.md')
    })

    expect(flushSheet).toHaveBeenCalledWith('/vault/model.md')
    expect(flushRichEditor).not.toHaveBeenCalled()
  })

  it('flushes text notes through the rich editor', () => {
    const flushRichEditor = vi.fn(() => true)
    const flushSheet = vi.fn()
    const sheetFlushRef = { current: flushSheet as ((path: string) => void) | null }
    const flushPendingEditorContentRef = renderFlushRegistration({
      activeTab: {
        entry: { path: '/vault/note.md', display: 'text' },
        content: '---\n_display: text\n---\n# Note',
      },
      flushPendingEditorChange: flushRichEditor,
      sheetFlushRef,
    })

    act(() => {
      flushPendingEditorContentRef.current?.('/vault/note.md')
    })

    expect(flushSheet).not.toHaveBeenCalled()
    expect(flushRichEditor).toHaveBeenCalledTimes(1)
  })
})
