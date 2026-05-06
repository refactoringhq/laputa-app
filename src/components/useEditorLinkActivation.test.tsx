import { useRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/url', async () => {
  const actual = await vi.importActual('../utils/url') as typeof import('../utils/url')
  return { ...actual, openExternalUrl: vi.fn().mockResolvedValue(undefined) }
})

import { openExternalUrl } from '../utils/url'
import { useEditorLinkActivation } from './useEditorLinkActivation'

const mockOpenExternalUrl = vi.mocked(openExternalUrl)

function Harness({ onNavigateWikilink }: { onNavigateWikilink: (target: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  useEditorLinkActivation(containerRef, onNavigateWikilink)
  return <div ref={containerRef} data-testid="editor-link-container" />
}

function renderHarness(onNavigateWikilink = vi.fn()) {
  render(<Harness onNavigateWikilink={onNavigateWikilink} />)
  return {
    container: screen.getByTestId('editor-link-container') as HTMLDivElement,
    onNavigateWikilink,
  }
}

function appendWikilink(container: HTMLElement, target: string) {
  const wikilink = document.createElement('span')
  wikilink.className = 'wikilink'
  wikilink.dataset.target = target
  container.appendChild(wikilink)
  return wikilink
}

function appendEditableWikilink(container: HTMLElement, target: string) {
  const editable = document.createElement('div')
  editable.setAttribute('contenteditable', 'true')
  const wikilink = appendWikilink(editable, target)
  container.appendChild(editable)
  return { editable, wikilink }
}

function appendUrl(container: HTMLElement, href: string) {
  const link = document.createElement('a')
  link.setAttribute('href', href)
  link.textContent = href
  container.appendChild(link)
  return link
}

function dispatchMouseEvent(target: HTMLElement, type: string, options: MouseEventInit = {}) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ...options,
  })
  target.dispatchEvent(event)
  return event
}

describe('useEditorLinkActivation', () => {
  beforeEach(() => {
    mockOpenExternalUrl.mockClear()
  })

  it('navigates wikilinks only on Cmd+click after the native click stack settles', async () => {
    const { container, onNavigateWikilink } = renderHarness()
    const wikilink = appendWikilink(container, 'Alpha Project')

    dispatchMouseEvent(wikilink, 'click')
    expect(onNavigateWikilink).not.toHaveBeenCalled()

    const modifiedClick = dispatchMouseEvent(wikilink, 'click', { metaKey: true })
    expect(modifiedClick.defaultPrevented).toBe(true)
    expect(onNavigateWikilink).not.toHaveBeenCalled()

    await Promise.resolve()
    expect(onNavigateWikilink).toHaveBeenCalledWith('Alpha Project')
  })

  it('consumes plain wikilink mousedown and click events before editor internals see stale link nodes', () => {
    const { container, onNavigateWikilink } = renderHarness()
    const wikilink = appendWikilink(container, 'Alpha Project')

    const mouseDown = dispatchMouseEvent(wikilink, 'mousedown')
    const click = dispatchMouseEvent(wikilink, 'click')

    expect(mouseDown.defaultPrevented).toBe(true)
    expect(click.defaultPrevented).toBe(true)
    expect(onNavigateWikilink).not.toHaveBeenCalled()
  })

  it('blurs an active editor before navigating a Cmd-clicked wikilink', async () => {
    const { container, onNavigateWikilink } = renderHarness()
    const { editable, wikilink } = appendEditableWikilink(container, 'Alpha Project')

    editable.focus()
    expect(document.activeElement).toBe(editable)

    fireEvent.click(wikilink, { metaKey: true })

    expect(document.activeElement).not.toBe(editable)
    await Promise.resolve()
    expect(onNavigateWikilink).toHaveBeenCalledWith('Alpha Project')
  })

  it('opens URLs only on Cmd+click', () => {
    const { container } = renderHarness()
    const link = appendUrl(container, 'https://example.com')

    const plainClick = dispatchMouseEvent(link, 'click')
    expect(mockOpenExternalUrl).not.toHaveBeenCalled()
    expect(plainClick.defaultPrevented).toBe(true)

    const modifiedClick = dispatchMouseEvent(link, 'click', { metaKey: true })
    expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://example.com')
    expect(modifiedClick.defaultPrevented).toBe(true)
  })

  it('blocks malformed URL anchors instead of opening or falling through', () => {
    const { container } = renderHarness()
    const link = appendUrl(container, 'https://exa mple.com')

    const plainClick = dispatchMouseEvent(link, 'click')
    const modifiedClick = dispatchMouseEvent(link, 'click', { metaKey: true })

    expect(plainClick.defaultPrevented).toBe(true)
    expect(modifiedClick.defaultPrevented).toBe(true)
    expect(mockOpenExternalUrl).not.toHaveBeenCalled()
  })

  it('ignores malformed URLs and links inside code blocks', () => {
    const { container, onNavigateWikilink } = renderHarness()
    const codeBlock = document.createElement('div')
    codeBlock.setAttribute('data-content-type', 'codeBlock')
    codeBlock.appendChild(appendWikilink(codeBlock, 'Inside Code'))
    container.appendChild(codeBlock)
    const badLink = appendUrl(container, 'not a url')

    fireEvent.click(codeBlock.firstElementChild!, { metaKey: true })
    fireEvent.click(badLink, { metaKey: true })

    expect(onNavigateWikilink).not.toHaveBeenCalled()
    expect(mockOpenExternalUrl).not.toHaveBeenCalled()
  })

  it('toggles follow-link cursor mode while Cmd is held', () => {
    const { container } = renderHarness()

    expect(container.hasAttribute('data-follow-links')).toBe(false)
    fireEvent.keyDown(window, { key: 'Meta', metaKey: true })
    expect(container.hasAttribute('data-follow-links')).toBe(true)
    fireEvent.keyUp(window, { key: 'Meta' })
    expect(container.hasAttribute('data-follow-links')).toBe(false)
  })
})
