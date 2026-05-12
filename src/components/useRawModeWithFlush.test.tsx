import { renderHook, act } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useRawModeWithFlush } from './useRawModeWithFlush'
import * as store from '../utils/vaultConfigStore'

const notePath = '/vault/project/test.md'
const originalContent = '# Test\n\nOriginal body\n'
const rawEditedContent = '# Test\n\nEdited in raw mode\n'

function makeEditor() {
  return {
    document: [],
    blocksToMarkdownLossy: vi.fn(() => originalContent),
  }
}

describe('useRawModeWithFlush', () => {
  beforeEach(() => {
    store.resetVaultConfigStore()
    store.bindVaultConfigStore(
      {
        zoom: null,
        view_mode: null,
        editor_mode: null,
        tag_colors: null,
        status_colors: null,
        property_display_modes: null,
      },
      vi.fn(),
    )
  })

  afterEach(() => {
    store.resetVaultConfigStore()
  })

  it('re-enters raw mode with pending raw edits while tab state is still stale', async () => {
    const onContentChange = vi.fn()
    const flushPendingEditorChangeRef = { current: vi.fn(() => false) }
    const editor = makeEditor()
    const { result } = renderHook(() => useRawModeWithFlush(
      editor as never,
      notePath,
      originalContent,
      onContentChange,
      undefined,
      flushPendingEditorChangeRef,
    ))

    await act(async () => {
      await result.current.handleToggleRaw()
    })
    act(() => {
      result.current.rawLatestContentRef.current = rawEditedContent
    })

    await act(async () => {
      await result.current.handleToggleRaw()
    })
    await act(async () => {
      await result.current.handleToggleRaw()
    })

    expect(onContentChange).toHaveBeenCalledWith(notePath, rawEditedContent)
    expect(result.current.rawLatestContentRef.current).toBe(rawEditedContent)
    expect(result.current.rawModeContentOverride).toEqual({
      path: notePath,
      content: rawEditedContent,
    })
  })
})
