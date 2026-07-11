import { useRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/url', async () => {
  const actual = await vi.importActual('../utils/url') as typeof import('../utils/url')
  return {
    ...actual,
    openExternalUrl: vi.fn().mockResolvedValue(undefined),
    openLocalFile: vi.fn().mockResolvedValue(undefined),
  }
})

import { openExternalUrl, openLocalFile } from '../utils/url'
import { useEditorLinkActivation } from './useEditorLinkActivation'

const mockOpenExternalUrl = vi.mocked(openExternalUrl)
const mockOpenLocalFile = vi.mocked(openLocalFile)

function Harness({
  onNavigateWikilink,
  sourceEntryPath,
  vaultPath,
}: {
  onNavigateWikilink: (target: string) => void
  sourceEntryPath?: string
  vaultPath?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  useEditorLinkActivation(containerRef, onNavigateWikilink, vaultPath, sourceEntryPath)
  return <div ref={containerRef} data-testid="editor-link-container" />
}

function renderHarness(
  onNavigateWikilink = vi.fn(),
  vaultPath?: string,
  sourceEntryPath?: string,
) {
  render(<Harness onNavigateWikilink={onNavigateWikilink} sourceEntryPath={sourceEntryPath} vaultPath={vaultPath} />)
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

function dispatchMouseEvent(target: Node, type: string, options: MouseEventInit = {}) {
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
    mockOpenLocalFile.mockClear()
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

  it('opens modified URL mousedown before editor internals see stale link nodes', () => {
    const { container } = renderHarness()
    const link = appendUrl(container, 'https://example.com')
    const targetMouseDown = vi.fn()
    link.addEventListener('mousedown', targetMouseDown)

    const plainMouseDown = dispatchMouseEvent(link, 'mousedown')
    expect(plainMouseDown.defaultPrevented).toBe(false)
    expect(targetMouseDown).toHaveBeenCalledOnce()
    targetMouseDown.mockClear()

    const modifiedMouseDown = dispatchMouseEvent(link, 'mousedown', { metaKey: true })

    expect(modifiedMouseDown.defaultPrevented).toBe(true)
    expect(targetMouseDown).not.toHaveBeenCalled()
    const click = dispatchMouseEvent(link, 'click', { metaKey: true })

    expect(click.defaultPrevented).toBe(true)
    expect(mockOpenExternalUrl).toHaveBeenCalledOnce()
    expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://example.com')
  })

  it('suppresses the follow-up modified URL click even when it arrives after zero-delay timers', () => {
    vi.useFakeTimers()
    try {
      const { container } = renderHarness()
      const link = appendUrl(container, 'https://example.com')

      const modifiedMouseDown = dispatchMouseEvent(link, 'mousedown', { ctrlKey: true })
      vi.advanceTimersByTime(0)
      const delayedClick = dispatchMouseEvent(link, 'click', { ctrlKey: true })

      expect(modifiedMouseDown.defaultPrevented).toBe(true)
      expect(delayedClick.defaultPrevented).toBe(true)
      expect(mockOpenExternalUrl).toHaveBeenCalledOnce()
      expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://example.com')
    } finally {
      vi.useRealTimers()
    }
  })

  it('handles URL events that originate on link text nodes', () => {
    const { container } = renderHarness()
    const link = appendUrl(container, 'https://example.com')
    const textNode = link.firstChild
    expect(textNode).toBeInstanceOf(Text)

    dispatchMouseEvent(textNode!, 'mousedown', { metaKey: true })
    const click = dispatchMouseEvent(textNode!, 'click', { metaKey: true })

    expect(click.defaultPrevented).toBe(true)
    expect(mockOpenExternalUrl).toHaveBeenCalledOnce()
    expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://example.com')
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

  it('opens relative attachment links through the active vault path', () => {
    const { container } = renderHarness(vi.fn(), '/vault')
    const link = appendUrl(container, 'attachments/report.pdf')

    const modifiedClick = dispatchMouseEvent(link, 'click', { metaKey: true })

    expect(modifiedClick.defaultPrevented).toBe(true)
    expect(mockOpenLocalFile).toHaveBeenCalledWith('/vault/attachments/report.pdf', '/vault')
    expect(mockOpenExternalUrl).not.toHaveBeenCalled()
  })

  it('routes markdown note links through note navigation', async () => {
    const { container, onNavigateWikilink } = renderHarness()
    const link = appendUrl(container, 'other.md')

    const modifiedClick = dispatchMouseEvent(link, 'click', { metaKey: true })

    expect(modifiedClick.defaultPrevented).toBe(true)
    expect(mockOpenExternalUrl).not.toHaveBeenCalled()
    expect(mockOpenLocalFile).not.toHaveBeenCalled()
    expect(onNavigateWikilink).not.toHaveBeenCalled()

    await Promise.resolve()
    expect(onNavigateWikilink).toHaveBeenCalledWith('other')
  })

  it('normalizes relative markdown note links from the source note path', async () => {
    const { container, onNavigateWikilink } = renderHarness(
      vi.fn(),
      undefined,
      '/vault/areas/current.md',
    )
    const link = appendUrl(container, '../projects/roadmap.md#goals')

    const modifiedClick = dispatchMouseEvent(link, 'click', { metaKey: true })

    expect(modifiedClick.defaultPrevented).toBe(true)
    await Promise.resolve()
    expect(onNavigateWikilink).toHaveBeenCalledWith('vault/projects/roadmap')
    expect(mockOpenExternalUrl).not.toHaveBeenCalled()
    expect(mockOpenLocalFile).not.toHaveBeenCalled()
  })

  it('scrolls same-note markdown anchors to matching headings', () => {
    const { container, onNavigateWikilink } = renderHarness()
    const link = appendUrl(container, '#project-goals')
    const heading = document.createElement('div')
    heading.setAttribute('data-content-type', 'heading')
    heading.textContent = 'Project Goals'
    heading.scrollIntoView = vi.fn()
    container.appendChild(heading)

    const modifiedClick = dispatchMouseEvent(link, 'click', { metaKey: true })

    expect(modifiedClick.defaultPrevented).toBe(true)
    expect(heading.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(onNavigateWikilink).not.toHaveBeenCalled()
    expect(mockOpenExternalUrl).not.toHaveBeenCalled()
    expect(mockOpenLocalFile).not.toHaveBeenCalled()
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
