import { describe, expect, it, vi } from 'vitest'
import { persistEditorStateBeforeMutation } from './editorMutationFlush'

describe('persistEditorStateBeforeMutation', () => {
  it('flushes editor buffers and saves content without settling a pending rename', async () => {
    const calls: string[] = []
    const flushPendingEditorContent = vi.fn((path: string) => calls.push(`editor:${path}`))
    const flushPendingRawContent = vi.fn((path: string) => calls.push(`raw:${path}`))
    const savePendingForPath = vi.fn(async (path: string) => {
      calls.push(`save:${path}`)
      return true
    })

    await persistEditorStateBeforeMutation({
      path: 'C:\\vault\\untitled-note-123.md',
      flushPendingEditorContent,
      flushPendingRawContent,
      savePendingForPath,
    })

    expect(calls).toEqual([
      'editor:C:\\vault\\untitled-note-123.md',
      'raw:C:\\vault\\untitled-note-123.md',
      'save:C:\\vault\\untitled-note-123.md',
    ])
  })
})
