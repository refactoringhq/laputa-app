import { useEffect, type RefObject } from 'react'
import { openEditorAttachmentOrUrl } from './editorAttachmentActions'

const CODE_CONTEXT_SELECTOR = '[data-content-type="codeBlock"], pre, code'
const HEADING_SELECTOR = '[data-content-type="heading"], h1, h2, h3, h4, h5, h6'
const MOUSEDOWN_URL_SUPPRESSION_MS = 750
const MARKDOWN_NOTE_EXT_RE = /\.(?:md|markdown)$/iu
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/iu
type LinkSourcePath = string | null | undefined
type LinkActivationContext = {
  container: HTMLElement
  onNavigateWikilink: (target: string) => void
  sourceEntryPath?: LinkSourcePath
  vaultPath?: string
}
type AnchorKeyRequest = { value: string }
type AnchorLookupRequest = {
  anchorKey: string
  container: HTMLElement
}
type AnchorMatchRequest = {
  anchorKey: string
  element: HTMLElement
}
type AnchorScrollRequest = {
  container: HTMLElement
  rawAnchor: string
}
type DecodeRequest = { value: string }
type LinkEventPhase = 'click' | 'mousedown'
type LinkEventRequest = {
  context: LinkActivationContext
  event: MouseEvent
  phase: LinkEventPhase
}
type ModifiedLinkActionRequest = {
  action: () => void
  context: LinkActivationContext
  event: MouseEvent
}
type HrefActivationRequest = {
  context: LinkActivationContext
  event: MouseEvent
  href: string
}
type MarkdownNoteTargetRequest = {
  href: string
  sourceEntryPath?: LinkSourcePath
}
type NavigationRequest = {
  context: LinkActivationContext
  target: string
}
type PathRequest = { path: string }
type SourceDirectoryRequest = { sourceEntryPath?: LinkSourcePath }
type FollowLinkStateRequest = {
  active: boolean
  container: HTMLElement
}
type HrefResolutionRequest = {
  event: MouseEvent
  phase: LinkEventPhase
  target: HTMLElement
}
type WikilinkEventRequest = LinkEventRequest & {
  wikilinkTarget: string
}

function hasFollowModifier(event: KeyboardEvent | MouseEvent) {
  return event.metaKey || event.ctrlKey
}

function isInsideCodeContext(target: HTMLElement) {
  return !!target.closest(CODE_CONTEXT_SELECTOR)
}

function elementFromEventTarget(target: EventTarget | null) {
  if (target instanceof HTMLElement) return target
  if (target instanceof Text) return target.parentElement
  return null
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

function setFollowLinksActive({ active, container }: FollowLinkStateRequest) {
  if (active) container.setAttribute('data-follow-links', '')
  else container.removeAttribute('data-follow-links')
}

function consumeEditorLinkEvent(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
}

function safeDecodeUriComponent({ value }: DecodeRequest) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function scheduleAfterNativeClick(callback: () => void) {
  if (typeof queueMicrotask === 'function') queueMicrotask(callback)
  else window.setTimeout(callback, 0)
}

function markdownAnchorKey({ value }: AnchorKeyRequest) {
  return safeDecodeUriComponent({ value })
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-')
}

function directAnchorMatches({ anchorKey, element }: AnchorMatchRequest) {
  const id = element.id ? markdownAnchorKey({ value: element.id }) : ''
  const name = element.getAttribute('name')
  return id === anchorKey || (name ? markdownAnchorKey({ value: name }) === anchorKey : false)
}

function findDirectAnchor({ anchorKey, container }: AnchorLookupRequest): HTMLElement | null {
  for (const element of Array.from(container.querySelectorAll<HTMLElement>('[id], a[name]'))) {
    if (directAnchorMatches({ anchorKey, element })) return element
  }
  return null
}

function findHeadingAnchor({ anchorKey, container }: AnchorLookupRequest): HTMLElement | null {
  for (const heading of Array.from(container.querySelectorAll<HTMLElement>(HEADING_SELECTOR))) {
    if (markdownAnchorKey({ value: heading.textContent ?? '' }) === anchorKey) return heading
  }
  return null
}

function findSameNoteAnchor({ container, rawAnchor }: AnchorScrollRequest): HTMLElement | null {
  const anchorKey = markdownAnchorKey({ value: rawAnchor })
  if (!anchorKey) return null

  return findDirectAnchor({ anchorKey, container }) ?? findHeadingAnchor({ anchorKey, container })
}

function scrollToSameNoteAnchor({ container, rawAnchor }: AnchorScrollRequest) {
  const target = findSameNoteAnchor({ container, rawAnchor })
  if (!target) {
    console.warn(`Markdown anchor target not found: #${rawAnchor}`)
    return
  }

  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function stripHrefFragmentAndQuery({ href }: Pick<MarkdownNoteTargetRequest, 'href'>) {
  const fragmentStart = href.indexOf('#')
  const withoutFragment = fragmentStart === -1 ? href : href.slice(0, fragmentStart)
  const queryStart = withoutFragment.indexOf('?')
  return queryStart === -1 ? withoutFragment : withoutFragment.slice(0, queryStart)
}

function normalizePathSegments({ path }: PathRequest) {
  const segments: string[] = []
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.join('/')
}

function sourceDirectory({ sourceEntryPath }: SourceDirectoryRequest) {
  const sourcePath = sourceEntryPath?.replace(/\\/g, '/')
  if (!sourcePath) return ''

  return sourcePath.split('/').slice(0, -1).join('/')
}

function markdownNoteTargetFromHref({ href, sourceEntryPath }: MarkdownNoteTargetRequest): string | null {
  const trimmed = href.trim()
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//') || URL_SCHEME_RE.test(trimmed)) return null

  const rawPath = stripHrefFragmentAndQuery({ href: trimmed })
  const decodedPath = safeDecodeUriComponent({ value: rawPath }).replace(/\\/g, '/')
  if (!MARKDOWN_NOTE_EXT_RE.test(decodedPath)) return null

  const pathStem = decodedPath.replace(MARKDOWN_NOTE_EXT_RE, '')
  const base = sourceDirectory({ sourceEntryPath })
  if (base && !pathStem.startsWith('/')) return normalizePathSegments({ path: `${base}/${pathStem}` })

  return normalizePathSegments({ path: pathStem.replace(/^\/+/u, '') })
}

function runModifiedLinkAction({ action, context, event }: ModifiedLinkActionRequest) {
  consumeEditorLinkEvent(event)
  if (!hasFollowModifier(event)) return

  blurActiveEditable(context.container)
  action()
}

function navigateNoteTarget({ context, target }: NavigationRequest) {
  scheduleAfterNativeClick(() => context.onNavigateWikilink(target))
}

function activateHref({ context, event, href }: HrefActivationRequest) {
  runModifiedLinkAction({
    context,
    event,
    action: () => {
      if (href.startsWith('#')) {
        scrollToSameNoteAnchor({ container: context.container, rawAnchor: href.slice(1) })
        return
      }

      const markdownTarget = markdownNoteTargetFromHref({ href, sourceEntryPath: context.sourceEntryPath })
      if (markdownTarget) {
        navigateNoteTarget({ context, target: markdownTarget })
        return
      }

      openEditorAttachmentOrUrl({ url: href, vaultPath: context.vaultPath, source: 'link' })
    },
  })
}

function linkEventTarget(event: MouseEvent): HTMLElement | null {
  const target = elementFromEventTarget(event.target)
  return target && !isInsideCodeContext(target) ? target : null
}

function handleWikilinkEvent({ context, event, phase, wikilinkTarget }: WikilinkEventRequest): null {
  consumeEditorLinkEvent(event)
  if (phase === 'click' && hasFollowModifier(event)) {
    blurActiveEditable(context.container)
    navigateNoteTarget({ context, target: wikilinkTarget })
  }

  return null
}

function hrefForLinkEvent({ event, phase, target }: HrefResolutionRequest): string | null {
  const href = resolveAnchorHref(target)
  if (!href) return null
  if (phase === 'mousedown' && !hasFollowModifier(event)) return null

  return href
}

function handleEditorLinkEvent(request: LinkEventRequest): string | null {
  const target = linkEventTarget(request.event)
  if (!target) return null

  const wikilinkTarget = resolveWikilinkTarget(target)
  if (wikilinkTarget) return handleWikilinkEvent({ ...request, wikilinkTarget })

  const href = hrefForLinkEvent({ event: request.event, phase: request.phase, target })
  if (!href) return null

  activateHref({ context: request.context, event: request.event, href })
  return request.phase === 'mousedown' ? href : null
}

function followedAnchorHrefFromEvent(event: MouseEvent, fallback: HTMLElement) {
  if (!hasFollowModifier(event)) return null

  return resolveAnchorHref(elementFromEventTarget(event.target) ?? fallback)
}

export function useEditorLinkActivation(
  containerRef: RefObject<HTMLDivElement | null>,
  onNavigateWikilink: (target: string) => void,
  vaultPath?: string,
  sourceEntryPath?: LinkSourcePath,
) {
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const resetModifierState = () => setFollowLinksActive({ active: false, container })
    const handleModifierChange = (event: KeyboardEvent) => {
      setFollowLinksActive({ active: hasFollowModifier(event), container })
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') resetModifierState()
    }
    const context: LinkActivationContext = {
      container,
      onNavigateWikilink,
      sourceEntryPath,
      vaultPath,
    }
    let handledMouseDownUrl: string | null = null
    let handledMouseDownUrlTimer: number | null = null
    const clearHandledMouseDownUrl = () => {
      handledMouseDownUrl = null
      if (handledMouseDownUrlTimer !== null) {
        window.clearTimeout(handledMouseDownUrlTimer)
        handledMouseDownUrlTimer = null
      }
    }
    const rememberHandledMouseDownUrl = (href: string) => {
      handledMouseDownUrl = href
      if (handledMouseDownUrlTimer !== null) window.clearTimeout(handledMouseDownUrlTimer)
      handledMouseDownUrlTimer = window.setTimeout(() => {
        if (handledMouseDownUrl === href) clearHandledMouseDownUrl()
      }, MOUSEDOWN_URL_SUPPRESSION_MS)
    }
    const handleMouseDown = (event: MouseEvent) => {
      const href = handleEditorLinkEvent({ context, event, phase: 'mousedown' })
      if (href) rememberHandledMouseDownUrl(href)
    }
    const handleClick = (event: MouseEvent) => {
      const followedHref = followedAnchorHrefFromEvent(event, container)
      if (handledMouseDownUrl && followedHref === handledMouseDownUrl) {
        clearHandledMouseDownUrl()
        consumeEditorLinkEvent(event)
        return
      }

      clearHandledMouseDownUrl()
      handleEditorLinkEvent({ context, event, phase: 'click' })
    }

    container.addEventListener('mousedown', handleMouseDown, true)
    container.addEventListener('click', handleClick, true)
    window.addEventListener('keydown', handleModifierChange)
    window.addEventListener('keyup', handleModifierChange)
    window.addEventListener('blur', resetModifierState)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      container.removeEventListener('mousedown', handleMouseDown, true)
      container.removeEventListener('click', handleClick, true)
      window.removeEventListener('keydown', handleModifierChange)
      window.removeEventListener('keyup', handleModifierChange)
      window.removeEventListener('blur', resetModifierState)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearHandledMouseDownUrl()
      resetModifierState()
    }
  }, [containerRef, onNavigateWikilink, sourceEntryPath, vaultPath])
}
