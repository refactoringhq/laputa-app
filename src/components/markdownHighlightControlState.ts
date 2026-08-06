import { useCallback, useEffect, useState } from 'react'
import { resolveEffectiveLocale, translate, type AppLocale } from '../lib/i18n'
import type { MarkdownHighlightColor } from '../utils/markdownHighlightMarkdown'
import type { HighlightEditor, MarkdownHighlightRange } from './markdownHighlightModel'
import { readMarkdownHighlightRange } from './markdownHighlightRange'

export type CursorControlState = MarkdownHighlightRange & {
  left: number
  top: number
}

export type ToolbarControlState = {
  button: HTMLElement
  left: number
  top: number
}

function currentLocale(): AppLocale {
  return resolveEffectiveLocale(document.documentElement.lang)
}

export function colorLabel(locale: AppLocale, color: MarkdownHighlightColor): string {
  switch (color) {
    case 'yellow':
      return translate(locale, 'editor.formatting.highlightYellow')
    case 'green':
      return translate(locale, 'editor.formatting.highlightGreen')
    case 'red':
      return translate(locale, 'editor.formatting.highlightRed')
    case 'blue':
      return translate(locale, 'editor.formatting.highlightBlue')
    case 'purple':
      return translate(locale, 'editor.formatting.highlightPurple')
  }
}

export function useEditorRevision(editor: HighlightEditor) {
  const [, setRevision] = useState(0)

  useEffect(() => {
    const update = () => setRevision(current => current + 1)
    const unsubscribeChange = editor.onChange(update)
    const unsubscribeSelection = editor.onSelectionChange(update)
    return () => {
      unsubscribeChange()
      unsubscribeSelection()
    }
  }, [editor])
}

export function useDocumentLocale(): AppLocale {
  const [locale, setLocale] = useState(currentLocale)

  useEffect(() => {
    const observer = new MutationObserver(() => setLocale(currentLocale()))
    observer.observe(document.documentElement, { attributeFilter: ['lang'] })
    return () => observer.disconnect()
  }, [])

  return locale
}

function readCursorControlState(editor: HighlightEditor): CursorControlState | null {
  const range = readMarkdownHighlightRange(editor)
  if (!range) return null

  try {
    const coordinates = editor.prosemirrorView.coordsAtPos(range.to)
    const left = Math.min(coordinates.right + 8, window.innerWidth - 32)
    const top = coordinates.top + (coordinates.bottom - coordinates.top) / 2
    return { ...range, left, top }
  } catch {
    return null
  }
}

export function useCursorControlState(editor: HighlightEditor): CursorControlState | null {
  const [state, setState] = useState(() => readCursorControlState(editor))
  const update = useCallback(() => setState(readCursorControlState(editor)), [editor])

  useEffect(() => {
    const unsubscribeChange = editor.onChange(update)
    const unsubscribeSelection = editor.onSelectionChange(update)
    window.addEventListener('resize', update)
    document.addEventListener('scroll', update, true)
    return () => {
      unsubscribeChange()
      unsubscribeSelection()
      window.removeEventListener('resize', update)
      document.removeEventListener('scroll', update, true)
    }
  }, [editor, update])

  return state
}

function readToolbarControlState(container: Element): ToolbarControlState | null {
  const button = container.querySelector<HTMLElement>(
    '.bn-formatting-toolbar [data-test="highlight"]',
  )
  if (!button?.isConnected) return null

  const rect = button.getBoundingClientRect()
  return { button, left: rect.right - 4, top: rect.top }
}

export function useToolbarControlState(container: Element): ToolbarControlState | null {
  const [state, setState] = useState(() => readToolbarControlState(container))
  const update = useCallback(() => setState(readToolbarControlState(container)), [container])

  useEffect(() => {
    const observer = new MutationObserver(update)
    observer.observe(container, { childList: true, subtree: true })
    window.addEventListener('resize', update)
    document.addEventListener('scroll', update, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      document.removeEventListener('scroll', update, true)
    }
  }, [container, update])

  return state
}
