import { useEffect, type RefObject } from 'react'
import { normalizeExternalUrl, openExternalUrl } from '../utils/url'

const CODE_CONTEXT_SELECTOR = '[data-content-type="codeBlock"], pre, code'

function hasFollowModifier(event: KeyboardEvent | MouseEvent) {
  return event.metaKey || event.ctrlKey
}

function isInsideCodeContext(target: HTMLElement) {
  return !!target.closest(CODE_CONTEXT_SELECTOR)
}

function resolveWikilinkTarget(target: HTMLElement) {
  return target.closest<HTMLElement>('.wikilink[data-target]')?.dataset.target ?? null
}

function resolveAnchorHref(target: HTMLElement) {
  return target.closest<HTMLAnchorElement>('a[href]')?.getAttribute('href')?.trim() ?? null
}

function blurActiveEditable(container: HTMLElement) {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !container.contains(active)) return
  const editable = active.isContentEditable ? active : active.closest<HTMLElement>('[contenteditable="true"]')
  editable?.blur()
}

function setFollowLinksActive(container: HTMLElement, active: boolean) {
  if (active) container.setAttribute('data-follow-links', '')
  else container.removeAttribute('data-follow-links')
}

function consumeEditorLinkEvent(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
}

function scheduleAfterNativeClick(callback: () => void) {
  if (typeof queueMicrotask === 'function') queueMicrotask(callback)
  else window.setTimeout(callback, 0)
}

function activateWikilink(
  event: MouseEvent,
  container: HTMLElement,
  target: string,
  onNavigateWikilink: (target: string) => void,
) {
  consumeEditorLinkEvent(event)

  if (!hasFollowModifier(event)) return

  blurActiveEditable(container)
  scheduleAfterNativeClick(() => onNavigateWikilink(target))
}

function activateExternalUrl(event: MouseEvent, href: string) {
  consumeEditorLinkEvent(event)

  if (!hasFollowModifier(event)) return

  const urlTarget = normalizeExternalUrl(href)
  if (!urlTarget) return

  openExternalUrl(urlTarget).catch((err) => console.warn('[link] Failed to open URL:', err))
}

function handleEditorLinkClick(
  event: MouseEvent,
  container: HTMLElement,
  onNavigateWikilink: (target: string) => void,
) {
  if (!(event.target instanceof HTMLElement) || isInsideCodeContext(event.target)) return

  const wikilinkTarget = resolveWikilinkTarget(event.target)
  if (wikilinkTarget) {
    activateWikilink(event, container, wikilinkTarget, onNavigateWikilink)
    return
  }

  const href = resolveAnchorHref(event.target)
  if (href) activateExternalUrl(event, href)
}

function handleEditorLinkMouseDown(event: MouseEvent) {
  if (!(event.target instanceof HTMLElement) || isInsideCodeContext(event.target)) return

  if (resolveWikilinkTarget(event.target)) consumeEditorLinkEvent(event)
}

export function useEditorLinkActivation(
  containerRef: RefObject<HTMLDivElement | null>,
  onNavigateWikilink: (target: string) => void,
) {
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const resetModifierState = () => setFollowLinksActive(container, false)
    const handleModifierChange = (event: KeyboardEvent) => {
      setFollowLinksActive(container, hasFollowModifier(event))
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') resetModifierState()
    }
    const handleClick = (event: MouseEvent) => {
      handleEditorLinkClick(event, container, onNavigateWikilink)
    }

    container.addEventListener('mousedown', handleEditorLinkMouseDown, true)
    container.addEventListener('click', handleClick, true)
    window.addEventListener('keydown', handleModifierChange)
    window.addEventListener('keyup', handleModifierChange)
    window.addEventListener('blur', resetModifierState)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      container.removeEventListener('mousedown', handleEditorLinkMouseDown, true)
      container.removeEventListener('click', handleClick, true)
      window.removeEventListener('keydown', handleModifierChange)
      window.removeEventListener('keyup', handleModifierChange)
      window.removeEventListener('blur', resetModifierState)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      resetModifierState()
    }
  }, [containerRef, onNavigateWikilink])
}
