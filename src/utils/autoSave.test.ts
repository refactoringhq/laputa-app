import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushEditorContent, type FlushDeps } from './autoSave'

const mockInvokeFn = vi.fn(() => Promise.resolve(null))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: (cmd: string, args?: Record<string, unknown>) => mockInvokeFn(cmd, args),
  updateMockContent: vi.fn(),
}))

async function expectUnsavedContentFlushes(deps: FlushDeps, content: string) {
  ;(deps.getTabContent as ReturnType<typeof vi.fn>).mockReturnValue(content)
  ;(deps.isUnsaved as ReturnType<typeof vi.fn>).mockReturnValue(true)

  await flushEditorContent('/vault/note.md', deps)

  expect(mockInvokeFn).toHaveBeenCalledWith('save_note_content', {
    path: '/vault/note.md',
    content,
  })
  expect(deps.onSaved).toHaveBeenCalledWith('/vault/note.md', content)
}

describe('flushEditorContent', () => {
  let deps: FlushDeps

  beforeEach(() => {
    vi.clearAllMocks()
    deps = {
      savePendingForPath: vi.fn().mockResolvedValue(false),
      getTabContent: vi.fn().mockReturnValue(undefined),
      isUnsaved: vi.fn().mockReturnValue(false),
      onSaved: vi.fn(),
    }
  })

  it('flushes via savePendingForPath when pending content matches path', async () => {
    ;(deps.savePendingForPath as ReturnType<typeof vi.fn>).mockResolvedValue(true)

    await flushEditorContent('/vault/note.md', deps)

    expect(deps.savePendingForPath).toHaveBeenCalledWith('/vault/note.md')
    // Should NOT check tab content or persist — pending flush handled it
    expect(deps.getTabContent).not.toHaveBeenCalled()
    expect(mockInvokeFn).not.toHaveBeenCalled()
  })

  it('saves tab content when note is unsaved (newly created)', async () => {
    await expectUnsavedContentFlushes(deps, '# New note content')
  })

  it('saves tab content when note is marked unsaved (dirty editor)', async () => {
    await expectUnsavedContentFlushes(deps, 'edited body')
  })

  it('does not save when note is not unsaved (clean editor)', async () => {
    ;(deps.getTabContent as ReturnType<typeof vi.fn>).mockReturnValue('same content')
    ;(deps.isUnsaved as ReturnType<typeof vi.fn>).mockReturnValue(false)

    await flushEditorContent('/vault/note.md', deps)

    expect(mockInvokeFn).not.toHaveBeenCalled()
    expect(deps.onSaved).not.toHaveBeenCalled()
  })

  it('does nothing when note is not open in any tab', async () => {
    // getTabContent returns undefined (no tab for this path)
    await flushEditorContent('/vault/note.md', deps)

    expect(mockInvokeFn).not.toHaveBeenCalled()
    expect(deps.onSaved).not.toHaveBeenCalled()
  })

  it('propagates errors from persistContent', async () => {
    ;(deps.getTabContent as ReturnType<typeof vi.fn>).mockReturnValue('content')
    ;(deps.isUnsaved as ReturnType<typeof vi.fn>).mockReturnValue(true)
    mockInvokeFn.mockRejectedValueOnce(new Error('Disk full'))

    await expect(flushEditorContent('/vault/note.md', deps)).rejects.toThrow('Disk full')
    expect(deps.onSaved).not.toHaveBeenCalled()
  })

  it('propagates errors from savePendingForPath', async () => {
    ;(deps.savePendingForPath as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Save failed'))

    await expect(flushEditorContent('/vault/note.md', deps)).rejects.toThrow('Save failed')
  })
})
