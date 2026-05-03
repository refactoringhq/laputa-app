import { invoke } from '@tauri-apps/api/core'
import { trackEvent } from '../lib/telemetry'
import { isTauri, mockInvoke } from '../mock-tauri'

export type PlainTextPasteSurface =
  | 'focused_contenteditable'
  | 'focused_input'
  | 'raw_editor'
  | 'rich_editor'

export interface PlainTextPasteTarget {
  surface: PlainTextPasteSurface
  contains: (element: Element | null) => boolean
  insert: (text: string) => boolean
  isConnected: () => boolean
}

let activePasteTarget: PlainTextPasteTarget | null = null

function activeElement(): HTMLElement | null {
  const active = document.activeElement
  return active instanceof HTMLElement ? active : null
}

function isCommandPaletteElement(element: Element | null): boolean {
  return Boolean(element?.closest('[data-command-palette="true"]'))
}

function isUsableTarget(target: PlainTextPasteTarget | null): target is PlainTextPasteTarget {
  return Boolean(target?.isConnected())
}

function recordPlainTextPaste(surface: PlainTextPasteSurface): void {
  trackEvent('plain_text_paste_used', { surface })
}

function inputEvent(text: string): Event {
  if (typeof InputEvent === 'function') {
    return new InputEvent('input', {
      bubbles: true,
      cancelable: false,
      data: text,
      inputType: 'insertText',
    })
  }

  return new Event('input', { bubbles: true })
}

function isPlainTextInput(element: HTMLInputElement): boolean {
  const plainTextTypes = new Set([
    '',
    'email',
    'password',
    'search',
    'tel',
    'text',
    'url',
  ])

  return plainTextTypes.has(element.type)
}

function insertIntoTextControl(element: HTMLInputElement | HTMLTextAreaElement, text: string): boolean {
  if (element.readOnly || element.disabled) return false
  if (element instanceof HTMLInputElement && !isPlainTextInput(element)) return false

  const start = element.selectionStart ?? element.value.length
  const end = element.selectionEnd ?? start
  element.setRangeText(text, start, end, 'end')
  element.dispatchEvent(inputEvent(text))
  return true
}

function insertIntoContentEditable(element: HTMLElement, text: string): boolean {
  if (!element.isContentEditable && !element.closest('[contenteditable="true"]')) return false

  if (document.queryCommandSupported?.('insertText') && document.execCommand('insertText', false, text)) {
    return true
  }

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false

  const range = selection.getRangeAt(0)
  range.deleteContents()
  range.insertNode(document.createTextNode(text))
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
  element.dispatchEvent(inputEvent(text))
  return true
}

function insertIntoFocusedEditable(text: string, element: HTMLElement | null): PlainTextPasteSurface | null {
  if (!element) return null
  if (isCommandPaletteElement(element)) return null

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return insertIntoTextControl(element, text) ? 'focused_input' : null
  }

  return insertIntoContentEditable(element, text) ? 'focused_contenteditable' : null
}

function isEditableElementForPlainTextPaste(element: HTMLElement | null): boolean {
  if (!element || isCommandPaletteElement(element)) return false
  return (element instanceof HTMLInputElement && isPlainTextInput(element))
    || element instanceof HTMLTextAreaElement
    || element.isContentEditable
    || element.closest('[contenteditable="true"]') !== null
}

function insertIntoTarget(target: PlainTextPasteTarget, text: string): boolean {
  if (!target.insert(text)) return false
  recordPlainTextPaste(target.surface)
  return true
}

function currentPasteTarget(): PlainTextPasteTarget | null {
  return isUsableTarget(activePasteTarget) ? activePasteTarget : null
}

function insertIntoContainedTarget(
  target: PlainTextPasteTarget | null,
  element: HTMLElement | null,
  text: string,
): boolean {
  return Boolean(target?.contains(element) && insertIntoTarget(target, text))
}

function insertIntoFocusedSurface(text: string, element: HTMLElement | null): boolean {
  const focusedSurface = insertIntoFocusedEditable(text, element)
  if (!focusedSurface) return false

  recordPlainTextPaste(focusedSurface)
  return true
}

function shouldUseLastPasteTarget(element: HTMLElement | null): boolean {
  if (!element) return true
  if (isCommandPaletteElement(element)) return true
  return !isEditableElementForPlainTextPaste(element)
}

function insertIntoLastTarget(
  target: PlainTextPasteTarget | null,
  element: HTMLElement | null,
  text: string,
): boolean {
  if (!target || !shouldUseLastPasteTarget(element)) return false
  return insertIntoTarget(target, text)
}

export function registerPlainTextPasteTarget(target: PlainTextPasteTarget): () => void {
  activePasteTarget = target

  return () => {
    if (activePasteTarget === target) {
      activePasteTarget = null
    }
  }
}

export function activatePlainTextPasteTarget(target: PlainTextPasteTarget): void {
  activePasteTarget = target
}

export function insertPlainTextFromClipboardText(text: string): boolean {
  if (text.length === 0) return false

  const currentElement = activeElement()
  const target = currentPasteTarget()

  return insertIntoContainedTarget(target, currentElement, text)
    || insertIntoFocusedSurface(text, currentElement)
    || insertIntoLastTarget(target, currentElement, text)
}

async function readClipboardText(): Promise<string> {
  if (isTauri()) {
    return invoke<string>('read_text_from_clipboard')
  }

  if (navigator.clipboard?.readText) {
    return navigator.clipboard.readText()
  }

  return mockInvoke<string>('read_text_from_clipboard')
}

export async function requestPlainTextPaste(): Promise<boolean> {
  const text = await readClipboardText()
  return insertPlainTextFromClipboardText(text)
}
