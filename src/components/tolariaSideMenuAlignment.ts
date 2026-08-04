import { useLayoutEffect } from 'react'
import {
  blockElementById,
  editorBlockElement,
  type TolariaBlockNoteEditor,
} from './tolariaBlockNoteDom'
import type { SideMenuBlock } from './tolariaSideMenuBlocks'

type SideMenuAlignmentState = {
  attemptsRemaining: number
  frame: number | null
  hasObservedTargets: boolean
}
type SideMenuAlignmentContext = {
  blockId: string
  editorElement: HTMLElement
  observeTargets: () => void
  ownerWindow: Window
  retry: () => void
  state: SideMenuAlignmentState
}

const SIDE_MENU_ALIGNMENT_ATTEMPTS = 8

function htmlElement(element: Element | null): HTMLElement | null {
  return element instanceof HTMLElement ? element : null
}

function sideMenuElementForEditor(editorElement: HTMLElement): HTMLElement | null {
  const container = htmlElement(editorElement.closest('.editor__blocknote-container')) ?? editorElement
  return htmlElement(container.querySelector('.bn-side-menu'))
}

function hasVisibleArea(rect: DOMRect): boolean {
  return rect.width > 0 && rect.height > 0
}

function blockTextContentElement(blockElement: HTMLElement): HTMLElement | null {
  const content = htmlElement(blockElement.querySelector('.bn-block-content'))
  if (!content) return null
  return htmlElement(content.querySelector('.bn-inline-content')) ?? content
}

function visibleRect(rect: DOMRect): DOMRect | null {
  return rect.height > 0 ? rect : null
}

function blockTextAnchorRect(blockElement: HTMLElement): DOMRect | null {
  const inlineContent = blockTextContentElement(blockElement)
  if (!inlineContent) return null

  const ownerDocument = inlineContent.ownerDocument
  const range = ownerDocument.createRange()
  range.selectNodeContents(inlineContent)
  const firstLineRect = Array.from(range.getClientRects())
    .find(hasVisibleArea)
  const textRect = firstLineRect ?? range.getBoundingClientRect()
  range.detach()

  return visibleRect(textRect) ?? visibleRect(inlineContent.getBoundingClientRect())
}

function alignSideMenuWithBlockText(editorElement: HTMLElement, blockId: string): boolean {
  const blockElement = blockElementById(editorElement, blockId)
  const sideMenu = sideMenuElementForEditor(editorElement)
  if (!blockElement || !sideMenu) return false

  const anchorRect = blockTextAnchorRect(blockElement)
  if (!anchorRect) return false

  sideMenu.style.removeProperty('translate')
  const sideMenuRect = sideMenu.getBoundingClientRect()
  if (sideMenuRect.height <= 0) return false

  const anchorCenter = anchorRect.top + anchorRect.height / 2
  const sideMenuCenter = sideMenuRect.top + sideMenuRect.height / 2
  sideMenu.style.setProperty('translate', `0 ${anchorCenter - sideMenuCenter}px`)
  return true
}

function createSideMenuAlignmentState(): SideMenuAlignmentState {
  return {
    attemptsRemaining: SIDE_MENU_ALIGNMENT_ATTEMPTS,
    frame: null,
    hasObservedTargets: false,
  }
}

function createSideMenuResizeObserver(onResize: () => void): ResizeObserver | null {
  return typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(onResize)
}

function observeSideMenuAlignmentTargets({
  blockId,
  editorElement,
  resizeObserver,
  state,
}: {
  blockId: string
  editorElement: HTMLElement
  resizeObserver: ResizeObserver | null
  state: SideMenuAlignmentState
}) {
  if (state.hasObservedTargets) return

  const blockElement = blockElementById(editorElement, blockId)
  const sideMenu = sideMenuElementForEditor(editorElement)
  if (!resizeObserver || !blockElement || !sideMenu) return

  resizeObserver.observe(blockElement)
  resizeObserver.observe(sideMenu)
  state.hasObservedTargets = true
}

function scheduleSideMenuTextAlignment(context: SideMenuAlignmentContext) {
  const { blockId, editorElement, observeTargets, ownerWindow, retry, state } = context
  if (state.frame !== null) return

  state.frame = ownerWindow.requestAnimationFrame(() => {
    state.frame = null
    const aligned = alignSideMenuWithBlockText(editorElement, blockId)
    observeTargets()
    if (!aligned && state.attemptsRemaining > 0) {
      state.attemptsRemaining -= 1
      retry()
    }
  })
}

function createSideMenuAlignmentCleanup({
  editorElement,
  ownerWindow,
  resizeObserver,
  scheduleAlignment,
  state,
}: {
  editorElement: HTMLElement
  ownerWindow: Window
  resizeObserver: ResizeObserver | null
  scheduleAlignment: () => void
  state: SideMenuAlignmentState
}) {
  return () => {
    if (state.frame !== null) ownerWindow.cancelAnimationFrame(state.frame)
    resizeObserver?.disconnect()
    ownerWindow.removeEventListener('resize', scheduleAlignment)
    sideMenuElementForEditor(editorElement)?.style.removeProperty('translate')
  }
}

function createSideMenuAlignmentController(editor: TolariaBlockNoteEditor, blockId: string) {
  const editorElement = editorBlockElement(editor)
  const ownerWindow = editorElement?.ownerDocument.defaultView
  if (!editorElement || !ownerWindow) return undefined

  const state = createSideMenuAlignmentState()
  let resizeObserver: ResizeObserver | null = null
  const observeTargets = () => { observeSideMenuAlignmentTargets({
    blockId,
    editorElement,
    resizeObserver,
    state,
  }); }
  const scheduleAlignment = () => { scheduleSideMenuTextAlignment({
    blockId,
    editorElement,
    observeTargets,
    ownerWindow,
    retry: scheduleAlignment,
    state,
  }); }

  resizeObserver = createSideMenuResizeObserver(scheduleAlignment)
  scheduleAlignment()
  observeTargets()
  ownerWindow.addEventListener('resize', scheduleAlignment)

  return createSideMenuAlignmentCleanup({
    editorElement,
    ownerWindow,
    resizeObserver,
    scheduleAlignment,
    state,
  })
}

export function useSideMenuTextAlignment(
  editor: TolariaBlockNoteEditor,
  block: SideMenuBlock | undefined,
) {
  const blockId = block?.id

  useLayoutEffect(() => {
    if (!blockId) return

    return createSideMenuAlignmentController(editor, blockId)
  }, [blockId, editor])
}
