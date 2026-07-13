import { createExtension } from '@blocknote/core'

const POST_COMPOSITION_STRUCTURAL_GUARD_MS = 250
const POST_COMPOSITION_KEY_BEFOREINPUT_PAIR_MS = 80
const IME_TEXT_KEY_INSERT_PAIR_MS = 150
const IME_GUARD_PATCHED = '__tolariaImeCompositionGuardPatched'

interface ComposingEditorView {
  composing?: boolean
}

type ImeDebuggableView = ComposingEditorView & {
  __tolariaImeCompositionTextRange?: ImeCompositionTextRange
  __tolariaImeCompositionGuardPatched?: boolean
  dispatch?: (transaction: unknown) => void
  someProp?: (propName: string, callback?: unknown) => unknown
  state?: {
    doc?: {
      content?: { size?: number }
      textBetween?: (from: number, to: number) => string
    }
    selection?: {
      anchor?: number
      from?: number
      head?: number
      to?: number
      constructor?: { name?: string }
    }
    tr?: {
      insertText?: (text: string, from?: number, to?: number) => unknown
    }
  }
}

interface ImeCompositionTextRange {
  from: number
  text: string
  to: number
}

function isComposingKeyEvent(event: KeyboardEvent, view?: ComposingEditorView | null): boolean {
  return event.isComposing || event.keyCode === 229 || Boolean(view?.composing)
}

function isEnterKey(event: KeyboardEvent): boolean {
  return event.key === 'Enter'
    || event.code === 'Enter'
    || event.code === 'NumpadEnter'
    || event.keyCode === 13
}

function isTabKey(event: KeyboardEvent): boolean {
  return event.key === 'Tab'
    || event.code === 'Tab'
    || event.keyCode === 9
}

function isStructuralKey(event: KeyboardEvent): boolean {
  return isEnterKey(event) || isTabKey(event)
}

function isStructuralBeforeInput(event: InputEvent): boolean {
  return event.inputType === 'insertParagraph'
    || event.inputType === 'insertLineBreak'
}

function isCompositionInput(event: InputEvent): boolean {
  return event.isComposing
    || event.inputType === 'insertCompositionText'
    || event.inputType === 'insertFromComposition'
    || event.inputType === 'deleteCompositionText'
}

function isImeInterestingInput(event: InputEvent): boolean {
  return isStructuralBeforeInput(event)
    || isCompositionInput(event)
    || event.inputType === 'insertText'
}

function isSingleAsciiText(value: string | null): value is string {
  return typeof value === 'string' && /^[A-Za-z]$/.test(value)
}

function extractInsertedText(transaction: unknown): string | null {
  const tr = transaction as { steps?: unknown[] }
  if (!Array.isArray(tr.steps)) return null

  for (const step of tr.steps) {
    const json = typeof (step as { toJSON?: () => unknown }).toJSON === 'function'
      ? (step as { toJSON: () => unknown }).toJSON()
      : null
    const content = (json as { slice?: { content?: Array<{ text?: string }> } } | null)?.slice?.content
    const text = content
      ?.map((node) => node.text)
      .filter((value): value is string => typeof value === 'string')
      .join('')
    if (text) return text
  }

  return null
}

function extractCompositionTextRange(transaction: unknown): ImeCompositionTextRange | null {
  const tr = transaction as {
    getMeta?: (key: unknown) => unknown
    selection?: {
      anchor?: number
      from?: number
      head?: number
      to?: number
    }
  }
  if (typeof tr.getMeta !== 'function' || tr.getMeta('composition') == null) return null

  const text = extractInsertedText(transaction)
  if (!text) return null

  const rawFrom = tr.selection?.from ?? tr.selection?.anchor
  const rawTo = tr.selection?.to ?? tr.selection?.head
  if (typeof rawFrom !== 'number' || typeof rawTo !== 'number') return null

  const from = Math.min(rawFrom, rawTo)
  const to = Math.max(rawFrom, rawTo)
  if (to <= from) return null

  return { from, text, to }
}

function normalizeCompositionTextRange(
  view: ImeDebuggableView,
  range: ImeCompositionTextRange,
): ImeCompositionTextRange {
  const liveText = view.state?.doc?.textBetween?.(range.from, range.to)
  return typeof liveText === 'string' && liveText.length > 0
    ? { ...range, text: liveText }
    : range
}

function replaceRecordedCompositionText(
  view: ImeDebuggableView | null,
  text: string,
): boolean {
  const range = view?.__tolariaImeCompositionTextRange
  if (!view || !range) return false

  try {
    const currentText = view.state?.doc?.textBetween?.(range.from, range.to)
    if (currentText !== range.text) return false

    const transaction = view.state?.tr?.insertText?.(text, range.from, range.to)
    if (!transaction || typeof view.dispatch !== 'function') return false

    view.__tolariaImeCompositionTextRange = undefined
    view.dispatch(transaction)
    return true
  } catch {
    return false
  }
}

function patchViewForImeCompositionGuard(view?: ImeDebuggableView | null): void {
  if (!view || view[IME_GUARD_PATCHED]) return

  const originalSomeProp = view.someProp
  if (typeof originalSomeProp === 'function') {
    view.someProp = function patchedSomeProp(propName: string, callback?: unknown) {
      if (propName !== 'handleKeyDown' || typeof callback !== 'function') {
        return originalSomeProp.call(this, propName, callback)
      }

      return originalSomeProp.call(this, propName, (handler: unknown) => {
        if (typeof handler !== 'function') {
          return (callback as (handler: unknown) => unknown)(handler)
        }

        return (callback as (handler: unknown) => unknown)((viewArg: unknown, event: KeyboardEvent) => {
          const structural = isStructuralKey(event)
          const shouldStopActiveCompositionStructuralKey = structural
            && isComposingKeyEvent(event, viewArg as ImeDebuggableView)

          if (shouldStopActiveCompositionStructuralKey) {
            event.stopImmediatePropagation()
            return true
          }

          return (handler as (viewArg: unknown, event: KeyboardEvent) => unknown)(viewArg, event)
        })
      })
    }
  }

  const originalDispatch = view.dispatch
  if (typeof originalDispatch === 'function') {
    view.dispatch = function patchedDispatch(transaction: unknown) {
      const compositionTextRange = extractCompositionTextRange(transaction)

      const result = originalDispatch.call(this, transaction)

      if (compositionTextRange) {
        view.__tolariaImeCompositionTextRange = normalizeCompositionTextRange(view, compositionTextRange)
      }

      return result
    }
  }

  view[IME_GUARD_PATCHED] = true
}

export function shouldStopComposingEnterKey(
  event: KeyboardEvent,
  view?: ComposingEditorView | null,
): boolean {
  return isEnterKey(event) && isComposingKeyEvent(event, view)
}

export function shouldStopComposingStructuralKey(
  event: KeyboardEvent,
  view?: ComposingEditorView | null,
): boolean {
  return isStructuralKey(event) && isComposingKeyEvent(event, view)
}

export const createImeCompositionKeyGuardExtension = createExtension(({ editor }) => {
  const readView = () => editor._tiptapEditor?.view ?? editor.prosemirrorView
  const readDebuggableView = () => readView() as ImeDebuggableView | null
  let domComposing = false
  let recentCompositionEnd = false
  let shouldSuppressNextPostCompositionStructuralInput = false
  let lastSuppressedPostCompositionStructuralKeyAt = 0
  let lastImeTextKeyAt = 0
  let pendingImeAsciiLeak: ImeCompositionTextRange | null = null
  let clearRecentCompositionEndTimer: number | null = null

  const clearRecentCompositionEnd = () => {
    if (clearRecentCompositionEndTimer !== null) {
      window.clearTimeout(clearRecentCompositionEndTimer)
      clearRecentCompositionEndTimer = null
    }

    recentCompositionEnd = false
    shouldSuppressNextPostCompositionStructuralInput = false
    lastSuppressedPostCompositionStructuralKeyAt = 0
  }

  const handleCompositionStart = () => {
    clearRecentCompositionEnd()
    domComposing = true
    if (pendingImeAsciiLeak) {
      const view = readDebuggableView()
      if (view) {
        view.__tolariaImeCompositionTextRange = pendingImeAsciiLeak
      }
      pendingImeAsciiLeak = null
    }
  }

  const handleCompositionEnd = () => {
    domComposing = false
    recentCompositionEnd = true
    shouldSuppressNextPostCompositionStructuralInput = true

    if (clearRecentCompositionEndTimer !== null) {
      window.clearTimeout(clearRecentCompositionEndTimer)
    }

    clearRecentCompositionEndTimer = window.setTimeout(() => {
      clearRecentCompositionEnd()
    }, POST_COMPOSITION_STRUCTURAL_GUARD_MS)
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    const structural = isStructuralKey(event)
    const interesting = structural || event.isComposing || event.keyCode === 229 || domComposing || recentCompositionEnd
    if (!interesting) return

    const view = readDebuggableView()
    if (!structural && event.keyCode === 229 && isSingleAsciiText(event.key)) {
      lastImeTextKeyAt = event.timeStamp
    }

    if (!structural) return

    if (isComposingKeyEvent(event, view) || domComposing) {
      event.stopImmediatePropagation()
      return
    }

    if (!recentCompositionEnd || !shouldSuppressNextPostCompositionStructuralInput) return

    shouldSuppressNextPostCompositionStructuralInput = false
    lastSuppressedPostCompositionStructuralKeyAt = event.timeStamp
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const handleBeforeInput = (event: InputEvent) => {
    const structural = isStructuralBeforeInput(event)
    if (!isImeInterestingInput(event)) return

    const view = readDebuggableView()
    const pairedWithImeTextKey = lastImeTextKeyAt > 0
      && event.timeStamp - lastImeTextKeyAt
      <= IME_TEXT_KEY_INSERT_PAIR_MS
    const pairedWithSuppressedKey = lastSuppressedPostCompositionStructuralKeyAt > 0
      && event.timeStamp - lastSuppressedPostCompositionStructuralKeyAt
      <= POST_COMPOSITION_KEY_BEFOREINPUT_PAIR_MS

    if (event.inputType === 'insertFromComposition' && typeof event.data === 'string') {
      if (replaceRecordedCompositionText(view, event.data)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
    }

    if (
      event.inputType === 'insertText'
      && isSingleAsciiText(event.data)
      && pairedWithImeTextKey
      && !event.isComposing
      && !domComposing
      && !view?.composing
    ) {
      const selection = view?.state?.selection
      const from = selection?.from ?? selection?.anchor
      const to = typeof from === 'number' ? from + event.data.length : null
      if (typeof from === 'number' && typeof to === 'number') {
        pendingImeAsciiLeak = { from, text: event.data, to }
      }
    }

    if (!structural) return

    if (
      event.isComposing
      || domComposing
      || Boolean(view?.composing)
      || (recentCompositionEnd && (
        shouldSuppressNextPostCompositionStructuralInput
        || pairedWithSuppressedKey
      ))
    ) {
      shouldSuppressNextPostCompositionStructuralInput = false
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }

  return {
    key: 'imeCompositionKeyGuard',
    mount: ({ dom, signal }) => {
      patchViewForImeCompositionGuard(readDebuggableView())
      dom.addEventListener('compositionstart', handleCompositionStart, {
        capture: true,
        signal,
      })
      dom.addEventListener('compositionupdate', handleCompositionStart, {
        capture: true,
        signal,
      })
      dom.addEventListener('compositionend', handleCompositionEnd, {
        capture: true,
        signal,
      })
      dom.addEventListener('compositioncancel', handleCompositionEnd as EventListener, {
        capture: true,
        signal,
      })
      dom.addEventListener('keydown', handleKeyDown, {
        capture: true,
        signal,
      })
      dom.addEventListener('beforeinput', handleBeforeInput, {
        capture: true,
        signal,
      })
      signal.addEventListener('abort', clearRecentCompositionEnd, { once: true })
    },
  } as const
})
