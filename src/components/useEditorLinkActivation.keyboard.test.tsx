import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useEditorLinkActivation } from './useEditorLinkActivation'

function KeyboardHarness({ onNavigate }: { onNavigate: (target: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  useEditorLinkActivation(containerRef, onNavigate)
  return <div ref={containerRef} data-testid="editor-links" />
}

function appendUnresolvedWikilink(container: HTMLElement) {
  const wikilink = document.createElement('span')
  wikilink.className = 'wikilink wikilink--broken'
  wikilink.dataset.target = 'new-note-topic'
  wikilink.textContent = 'New Note Topic'
  container.appendChild(wikilink)
  return wikilink
}

describe('keyboard wikilink activation', () => {
  it('makes unresolved wikilinks focusable and activates them with Enter', async () => {
    const onNavigate = vi.fn()
    render(<KeyboardHarness onNavigate={onNavigate} />)
    const container = screen.getByTestId('editor-links')
    const wikilink = appendUnresolvedWikilink(container)

    await waitFor(() => {
      expect(wikilink).toHaveAttribute('role', 'link')
      expect(wikilink).toHaveAttribute('tabindex', '0')
    })

    wikilink.focus()
    fireEvent.keyDown(wikilink, { key: 'Enter' })
    await Promise.resolve()

    expect(onNavigate).toHaveBeenCalledWith('new-note-topic')
  })
})
