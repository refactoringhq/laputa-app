import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { AUTO_SAVE_DEBOUNCE_MS, useEditorSave } from './useEditorSave'

const mockInvokeFn = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<null>>(() => Promise.resolve(null))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: (cmd: string, args?: Record<string, unknown>) => mockInvokeFn(cmd, args),
  updateMockContent: vi.fn(),
}))

describe('useEditorSave', () => {
  let updateVaultContent: Mock
  let setTabs: Mock
  let setToastMessage: Mock

  beforeEach(() => {
    updateVaultContent = vi.fn()
    setTabs = vi.fn()
    setToastMessage = vi.fn()
    mockInvokeFn.mockClear()
  })

  function renderSaveHook() {
    return renderHook(() => useEditorSave({ updateVaultContent, setTabs, setToastMessage }))
  }

  it('handleSave shows "Nothing to save" when no pending content', async () => {
    const { result } = renderSaveHook()

    await act(async () => {
      await result.current.handleSave()
    })

    expect(setToastMessage).toHaveBeenCalledWith('Nothing to save')
    expect(mockInvokeFn).not.toHaveBeenCalled()
  })

  it('handleSave persists pending content and shows "Saved"', async () => {
    const { result } = renderSaveHook()

    // Buffer content via handleContentChange
    act(() => {
      result.current.handleContentChange('/test/note.md', '---\ntitle: Test\n---\n\n# Test\n\nEdited')
    })

    // Save via Cmd+S
    await act(async () => {
      await result.current.handleSave()
    })

    expect(mockInvokeFn).toHaveBeenCalledWith('save_note_content', {
      path: '/test/note.md',
      content: '---\ntitle: Test\n---\n\n# Test\n\nEdited',
    })
    expect(setToastMessage).toHaveBeenCalledWith('Saved')

    // Second save should show "Nothing to save" (pending cleared)
    await act(async () => {
      await result.current.handleSave()
    })
    expect(setToastMessage).toHaveBeenCalledWith('Nothing to save')
  })

  it('handleSave shows error toast on failure', async () => {
    mockInvokeFn.mockRejectedValueOnce(new Error('Disk full'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderSaveHook()

    act(() => {
      result.current.handleContentChange('/test/note.md', 'content')
    })

    await act(async () => {
      await result.current.handleSave()
    })

    expect(setToastMessage).toHaveBeenCalledWith(expect.stringContaining('Save failed'))
    consoleSpy.mockRestore()
  })

  it('keeps failed Windows path saves pending with a recoverable error toast', async () => {
    const path = 'C:\\Users\\@raflymln\\notes\\untitled-note-1777236475.md'
    mockInvokeFn.mockRejectedValueOnce(
      new Error(`Failed to save ${path}: The filename, directory name, or volume label syntax is incorrect. (os error 123)`),
    )
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderSaveHook()

    act(() => {
      result.current.handleContentChange(path, '# Draft\n\nUnsaved body')
    })

    let saved = true
    await act(async () => {
      saved = await result.current.handleSave()
    })

    expect(saved).toBe(false)
    expect(setToastMessage).toHaveBeenCalledWith(
      'Save failed: The note path is invalid on this platform. Rename the note or move it to a valid folder, then try again.',
    )
    expect(updateVaultContent).not.toHaveBeenCalled()

    await act(async () => {
      saved = await result.current.handleSave()
    })

    expect(saved).toBe(true)
    expect(mockInvokeFn).toHaveBeenLastCalledWith('save_note_content', {
      path,
      content: '# Draft\n\nUnsaved body',
    })
    expect(updateVaultContent).toHaveBeenCalledWith(path, '# Draft\n\nUnsaved body')
    consoleSpy.mockRestore()
  })

  it('savePendingForPath saves content only for the matching path', async () => {
    const { result } = renderSaveHook()

    act(() => {
      result.current.handleContentChange('/test/note-a.md', 'content A')
    })

    // Try saving for a different path — should be a no-op
    await act(async () => {
      await result.current.savePendingForPath('/test/note-b.md')
    })
    expect(mockInvokeFn).not.toHaveBeenCalled()

    // Save for the correct path
    await act(async () => {
      await result.current.savePendingForPath('/test/note-a.md')
    })
    expect(mockInvokeFn).toHaveBeenCalledWith('save_note_content', {
      path: '/test/note-a.md',
      content: 'content A',
    })
  })

  it('calls onAfterSave callback after successful save', async () => {
    const cb = vi.fn()
    const { result } = renderHook(() =>
      useEditorSave({ updateVaultContent, setTabs, setToastMessage, onAfterSave: cb })
    )

    act(() => {
      result.current.handleContentChange('/test/note.md', 'new content')
    })

    await act(async () => {
      await result.current.handleSave()
    })

    expect(cb).toHaveBeenCalled()
  })

  it('calls onAfterSave even when nothing is pending (e.g. after rename)', async () => {
    const onAfterSave = vi.fn()
    const { result } = renderHook(() =>
      useEditorSave({ updateVaultContent, setTabs, setToastMessage, onAfterSave })
    )

    // No content buffered — simulate Cmd+S after a rename that already flushed pending
    await act(async () => {
      await result.current.handleSave()
    })

    expect(setToastMessage).toHaveBeenCalledWith('Nothing to save')
    expect(onAfterSave).toHaveBeenCalledOnce()
  })

  it('does not call onAfterSave when save fails', async () => {
    mockInvokeFn.mockRejectedValueOnce(new Error('Disk full'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cb = vi.fn()
    const { result } = renderHook(() =>
      useEditorSave({ updateVaultContent, setTabs, setToastMessage, onAfterSave: cb })
    )

    act(() => {
      result.current.handleContentChange('/test/note.md', 'content')
    })

    await act(async () => {
      await result.current.handleSave()
    })

    expect(cb).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('handleContentChange buffers the latest content', () => {
    const { result } = renderSaveHook()

    act(() => {
      result.current.handleContentChange('/test/note.md', 'v1')
      result.current.handleContentChange('/test/note.md', 'v2')
    })

    // The ref should hold the latest value — verified via save
    // (We'll check via the next handleSave call)
  })

  it('handleContentChange syncs content to tab state immediately', () => {
    const { result } = renderSaveHook()

    act(() => {
      result.current.handleContentChange('/test/note.md', '---\ntitle: T\n---\n\n# T\n\nLive edits')
    })

    // setTabs must be called on every content change (not just on save)
    // so that consumers like the AI panel see current editor content
    expect(setTabs).toHaveBeenCalled()
    const updater = setTabs.mock.calls[0][0]
    const tabs = [{ entry: { path: '/test/note.md' }, content: 'stale' }]
    const updated = updater(tabs)
    expect(updated[0].content).toBe('---\ntitle: T\n---\n\n# T\n\nLive edits')
  })

  it('save updates tab content with edited body, not original (regression)', async () => {
    const { result } = renderSaveHook()

    // Simulate: user opens note, edits body, presses Cmd+S
    const original = '---\ntitle: My Note\n---\n\n# My Note\n\nOriginal body'
    const edited = '---\ntitle: My Note\n---\n\n# My Note\n\nEdited body with changes'

    act(() => {
      result.current.handleContentChange('/vault/note.md', edited)
    })

    await act(async () => {
      await result.current.handleSave()
    })

    // The save must persist the EDITED content, not the original
    expect(mockInvokeFn).toHaveBeenCalledWith('save_note_content', {
      path: '/vault/note.md',
      content: edited,
    })

    // Tab content must be updated with the saved (edited) content
    expect(setTabs).toHaveBeenCalled()
    const tabUpdater = setTabs.mock.calls[0][0]
    const fakeTabs = [{ entry: { path: '/vault/note.md' }, content: original }]
    const updatedTabs = tabUpdater(fakeTabs)
    expect(updatedTabs[0].content).toBe(edited)

    // Vault in-memory state must also reflect the edit
    expect(updateVaultContent).toHaveBeenCalledWith('/vault/note.md', edited)
  })

  it('calls onNotePersisted with path and content after saving pending content', async () => {
    const onNotePersisted = vi.fn()
    const { result } = renderHook(() =>
      useEditorSave({ updateVaultContent, setTabs, setToastMessage, onNotePersisted })
    )

    act(() => {
      result.current.handleContentChange('/vault/theme/default.md', '---\nbackground: "#FFD700"\n---\n')
    })

    await act(async () => {
      await result.current.handleSave()
    })

    expect(onNotePersisted).toHaveBeenCalledWith(
      '/vault/theme/default.md',
      '---\nbackground: "#FFD700"\n---\n',
    )
  })

  it('calls onNotePersisted for unsaved fallback when no pending content', async () => {
    const onNotePersisted = vi.fn()
    const { result } = renderHook(() =>
      useEditorSave({ updateVaultContent, setTabs, setToastMessage, onNotePersisted })
    )

    // No handleContentChange — simulate Cmd+S on a newly created unsaved note
    await act(async () => {
      await result.current.handleSave({ path: '/vault/theme/default.md', content: '---\nbackground: "#FF0000"\n---\n' })
    })

    expect(onNotePersisted).toHaveBeenCalledWith(
      '/vault/theme/default.md',
      '---\nbackground: "#FF0000"\n---\n',
    )
  })

  describe('auto-save debounce', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('waits for a longer idle window so slower typing does not save mid-keystream', async () => {
      const lowEndTypingIntervalMs = 900
      const { result } = renderHook(() =>
        useEditorSave({ updateVaultContent, setTabs, setToastMessage })
      )

      act(() => { result.current.handleContentChange('/test/note.md', 'draft 1') })
      await act(async () => { vi.advanceTimersByTime(lowEndTypingIntervalMs) })
      expect(mockInvokeFn).not.toHaveBeenCalled()

      act(() => { result.current.handleContentChange('/test/note.md', 'draft 2') })
      await act(async () => { vi.advanceTimersByTime(lowEndTypingIntervalMs) })
      expect(mockInvokeFn).not.toHaveBeenCalled()

      await act(async () => {
        vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS - lowEndTypingIntervalMs)
      })

      expect(mockInvokeFn).toHaveBeenCalledWith('save_note_content', {
        path: '/test/note.md',
        content: 'draft 2',
      })
    })

    it('keeps newer pending content when an earlier slow auto-save resolves during typing', async () => {
      let resolveFirstSave!: () => void
      const firstSave = new Promise<void>((resolve) => { resolveFirstSave = resolve })
      mockInvokeFn
        .mockImplementationOnce(() => firstSave)
        .mockResolvedValue(undefined)
      const { result } = renderHook(() =>
        useEditorSave({ updateVaultContent, setTabs, setToastMessage })
      )

      act(() => { result.current.handleContentChange('/test/note.md', 'draft 1') })
      await act(async () => {
        vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS)
        await Promise.resolve()
      })
      expect(mockInvokeFn).toHaveBeenCalledTimes(1)

      act(() => { result.current.handleContentChange('/test/note.md', 'draft 2') })
      await act(async () => {
        resolveFirstSave()
        await firstSave
        await Promise.resolve()
      })

      expect(updateVaultContent).not.toHaveBeenCalledWith('/test/note.md', 'draft 1')

      await act(async () => { vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS) })

      expect(mockInvokeFn).toHaveBeenCalledTimes(2)
      expect(mockInvokeFn).toHaveBeenLastCalledWith('save_note_content', {
        path: '/test/note.md',
        content: 'draft 2',
      })
    })

    it('auto-saves after the idle debounce following the last content change', async () => {
      const onNotePersisted = vi.fn()
      const { result } = renderHook(() =>
        useEditorSave({ updateVaultContent, setTabs, setToastMessage, onNotePersisted })
      )

      act(() => {
        result.current.handleContentChange('/test/note.md', 'auto-saved content')
      })

      // Not saved yet
      expect(mockInvokeFn).not.toHaveBeenCalled()

      await act(async () => { vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS) })

      expect(mockInvokeFn).toHaveBeenCalledWith('save_note_content', {
        path: '/test/note.md',
        content: 'auto-saved content',
      })
      expect(onNotePersisted).toHaveBeenCalledWith('/test/note.md', 'auto-saved content')
    })

    it('resets debounce timer on each content change', async () => {
      const { result } = renderHook(() =>
        useEditorSave({ updateVaultContent, setTabs, setToastMessage })
      )

      act(() => { result.current.handleContentChange('/test/note.md', 'v1') })

      const almostIdleMs = AUTO_SAVE_DEBOUNCE_MS - 100
      await act(async () => { vi.advanceTimersByTime(almostIdleMs) })
      expect(mockInvokeFn).not.toHaveBeenCalled()

      // New edit resets timer
      act(() => { result.current.handleContentChange('/test/note.md', 'v2') })

      await act(async () => { vi.advanceTimersByTime(almostIdleMs) })
      expect(mockInvokeFn).not.toHaveBeenCalled()

      await act(async () => { vi.advanceTimersByTime(100) })
      expect(mockInvokeFn).toHaveBeenCalledWith('save_note_content', {
        path: '/test/note.md',
        content: 'v2',
      })
    })

    it('auto-save does not show toast', async () => {
      const { result } = renderHook(() =>
        useEditorSave({ updateVaultContent, setTabs, setToastMessage })
      )

      act(() => { result.current.handleContentChange('/test/note.md', 'content') })
      await act(async () => { vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS) })

      expect(setToastMessage).not.toHaveBeenCalled()
    })

    it('auto-save reports invalid path failures and leaves content retryable', async () => {
      const path = 'C:\\Users\\@raflymln\\notes\\untitled-note-1777236475.md'
      mockInvokeFn.mockRejectedValueOnce(new Error('The filename, directory name, or volume label syntax is incorrect. (os error 123)'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { result } = renderHook(() =>
        useEditorSave({ updateVaultContent, setTabs, setToastMessage })
      )

      act(() => { result.current.handleContentChange(path, 'draft from auto-save') })
      await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS) })

      expect(setToastMessage).toHaveBeenCalledWith(
        'Save failed: The note path is invalid on this platform. Rename the note or move it to a valid folder, then try again.',
      )
      expect(updateVaultContent).not.toHaveBeenCalled()

      await act(async () => { await result.current.handleSave() })

      expect(mockInvokeFn).toHaveBeenLastCalledWith('save_note_content', {
        path,
        content: 'draft from auto-save',
      })
      expect(updateVaultContent).toHaveBeenCalledWith(path, 'draft from auto-save')
      consoleSpy.mockRestore()
    })

    it('Cmd+S cancels pending auto-save and saves immediately', async () => {
      const { result } = renderHook(() =>
        useEditorSave({ updateVaultContent, setTabs, setToastMessage })
      )

      act(() => { result.current.handleContentChange('/test/note.md', 'content') })

      // Cmd+S before debounce fires
      await act(async () => { await result.current.handleSave() })

      expect(mockInvokeFn).toHaveBeenCalledTimes(1)
      expect(setToastMessage).toHaveBeenCalledWith('Saved')

      await act(async () => { vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS) })
      expect(mockInvokeFn).toHaveBeenCalledTimes(1)
    })

    it('auto-save calls onAfterSave', async () => {
      const onAfterSave = vi.fn()
      const { result } = renderHook(() =>
        useEditorSave({ updateVaultContent, setTabs, setToastMessage, onAfterSave })
      )

      act(() => { result.current.handleContentChange('/test/note.md', 'content') })
      await act(async () => { vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS) })

      expect(onAfterSave).toHaveBeenCalled()
    })

    it('clears auto-save timer on unmount', async () => {
      const { result, unmount } = renderHook(() =>
        useEditorSave({ updateVaultContent, setTabs, setToastMessage })
      )

      act(() => { result.current.handleContentChange('/test/note.md', 'content') })
      unmount()

      await act(async () => { vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS) })
      // Should not save after unmount
      expect(mockInvokeFn).not.toHaveBeenCalled()
    })
  })

  it('successive edits and saves persist each version correctly', async () => {
    const { result } = renderSaveHook()

    // First edit + save
    act(() => {
      result.current.handleContentChange('/vault/note.md', 'version 1')
    })
    await act(async () => {
      await result.current.handleSave()
    })
    expect(mockInvokeFn).toHaveBeenLastCalledWith('save_note_content', {
      path: '/vault/note.md',
      content: 'version 1',
    })

    // Second edit + save — must NOT revert to version 1
    act(() => {
      result.current.handleContentChange('/vault/note.md', 'version 2')
    })
    await act(async () => {
      await result.current.handleSave()
    })
    expect(mockInvokeFn).toHaveBeenLastCalledWith('save_note_content', {
      path: '/vault/note.md',
      content: 'version 2',
    })
  })
})
