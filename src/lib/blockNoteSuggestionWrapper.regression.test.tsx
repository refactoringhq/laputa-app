import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BlockNoteContext, SuggestionMenuWrapper } from '@blocknote/react'
import { describe, expect, it, vi } from 'vitest'
import type { SuggestionMenuProps } from '@blocknote/react'

function createEditor() {
  return {
    domElement: document.createElement('div'),
  }
}

function Menu({ items, onItemClick }: SuggestionMenuProps<string>) {
  return (
    <button type="button" onClick={() => onItemClick?.(items[0])}>
      Pick suggestion
    </button>
  )
}

describe('patched BlockNote suggestion wrapper', () => {
  it('ignores stale query cleanup before running a suggestion item action', async () => {
    const closeMenu = vi.fn()
    const clearQuery = vi.fn(() => {
      throw new RangeError('Position -1322 outside of fragment')
    })
    const onItemClick = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(
      <BlockNoteContext.Provider
        value={{
          editor: createEditor() as never,
          setContentEditableProps: vi.fn(),
        }}
      >
        <SuggestionMenuWrapper
          query=""
          closeMenu={closeMenu}
          clearQuery={clearQuery}
          getItems={async () => ['paragraph']}
          suggestionMenuComponent={Menu}
          onItemClick={onItemClick}
        />
      </BlockNoteContext.Provider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Pick suggestion' }))

    expect(closeMenu).toHaveBeenCalledOnce()
    expect(clearQuery).toHaveBeenCalledOnce()
    expect(onItemClick).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        'Ignored stale suggestion menu query cleanup:',
        expect.any(RangeError),
      )
    })
    warn.mockRestore()
  })
})
