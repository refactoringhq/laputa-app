import type { EditorView } from '@codemirror/view'
import type { ChangeEvent, KeyboardEvent, MutableRefObject, RefObject } from 'react'
import type { AppLocale } from '../lib/i18n'
import type { EditorFindMatch } from '../utils/editorFind'

export interface RawEditorFindRequest {
  id: number
  path: string
  replace: boolean
}

export interface RawEditorFindBarProps {
  doc: string
  locale?: AppLocale
  onClose: () => void
  onReplaceOpenChange: (open: boolean) => void
  open: boolean
  path: string
  replaceOpen: boolean
  request?: RawEditorFindRequest | null
  viewRef: MutableRefObject<EditorView | null>
}

export interface ActiveEditorFindMatchSelection {
  activeMatch?: EditorFindMatch
  open: boolean
  viewRef: MutableRefObject<EditorView | null>
}

export interface RawEditorFindController {
  caseSensitive: boolean
  close: () => void
  findInputRef: RefObject<HTMLInputElement | null>
  handleFindChange: (event: ChangeEvent<HTMLInputElement>) => void
  handleFindKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  hasMatches: boolean
  moveNext: () => void
  movePrevious: () => void
  query: string
  regex: boolean
  replaceAll: () => void
  replaceCurrent: () => void
  replacement: string
  setReplacement: (value: string) => void
  status: string
  toggleCaseSensitive: () => void
  toggleRegex: () => void
}
