import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, X } from 'lucide-react'
import { EditorView } from '@codemirror/view'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { translate, type AppLocale } from '../lib/i18n'
import {
  buildEditorFindReplacementChange,
  buildEditorFindReplacementChanges,
  clampEditorFindIndex,
  findEditorMatches,
  nextEditorFindIndex,
  type EditorFindMatch,
  type EditorFindOptions,
} from '../utils/editorFind'

export interface RawEditorFindRequest {
  id: number
  path: string
  replace: boolean
}

interface RawEditorFindBarProps {
  doc: string
  locale?: AppLocale
  onClose: () => void
  onReplaceOpenChange: (open: boolean) => void
  open: boolean
  path: string
  replaceOpen: boolean
  request?: RawEditorFindRequest | null
  viewRef: React.MutableRefObject<EditorView | null>
}

function selectMatch(view: EditorView, match: EditorFindMatch, focusEditor: boolean): void {
  view.dispatch({
    selection: { anchor: match.from, head: match.to },
    effects: EditorView.scrollIntoView(match.from, { y: 'center' }),
  })
  if (focusEditor) view.focus()
}

function matchStatusText(
  locale: AppLocale,
  error: string | null,
  activeIndex: number,
  matchCount: number,
): string {
  if (error === 'Invalid regex') return translate(locale, 'editor.find.invalidRegex')
  if (error) return translate(locale, 'editor.find.regexMustMatchText')
  if (matchCount === 0) return translate(locale, 'editor.find.noMatches')
  return translate(locale, 'editor.find.matchCount', {
    current: clampEditorFindIndex(activeIndex, matchCount) + 1,
    total: matchCount,
  })
}

function useRequestFocus({
  inputRef,
  onReplaceOpenChange,
  open,
  path,
  request,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  onReplaceOpenChange: (open: boolean) => void
  open: boolean
  path: string
  request?: RawEditorFindRequest | null
}) {
  useEffect(() => {
    if (!open || !request || request.path !== path) return
    if (request.replace) onReplaceOpenChange(true)

    const frameId = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(frameId)
  }, [inputRef, onReplaceOpenChange, open, path, request])
}

function focusEditorOnNextFrame(viewRef: React.MutableRefObject<EditorView | null>): void {
  requestAnimationFrame(() => viewRef.current?.focus())
}

function closeRawEditorFind(
  onClose: () => void,
  viewRef: React.MutableRefObject<EditorView | null>,
): void {
  onClose()
  focusEditorOnNextFrame(viewRef)
}

function handleRawEditorFindKeyDown(
  event: React.KeyboardEvent<HTMLInputElement>,
  close: () => void,
  moveMatch: (direction: 1 | -1) => void,
): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Enter') return

  event.preventDefault()
  moveMatch(event.shiftKey ? -1 : 1)
}

function handleRawEditorFindBarKeyDown(
  event: React.KeyboardEvent<HTMLDivElement>,
  close: () => void,
): void {
  if (event.key !== 'Escape') return

  event.preventDefault()
  close()
}

function selectActiveEditorFindMatch(
  viewRef: React.MutableRefObject<EditorView | null>,
  open: boolean,
  activeMatch?: EditorFindMatch,
): void {
  const view = viewRef.current
  if (!open || !view || !activeMatch) return
  selectMatch(view, activeMatch, false)
}

function replaceCurrentEditorFindMatch({
  activeMatch,
  options,
  query,
  replacement,
  viewRef,
}: {
  activeMatch?: EditorFindMatch
  options: EditorFindOptions
  query: string
  replacement: string
  viewRef: React.MutableRefObject<EditorView | null>
}): void {
  const view = viewRef.current
  if (!view || !activeMatch) return

  const change = buildEditorFindReplacementChange(activeMatch, query, replacement, options)
  view.dispatch({
    changes: change,
    selection: { anchor: change.from, head: change.from + change.insert.length },
    effects: EditorView.scrollIntoView(change.from, { y: 'center' }),
  })
  view.focus()
}

function replaceAllEditorFindMatches({
  matches,
  options,
  query,
  replacement,
  viewRef,
}: {
  matches: readonly EditorFindMatch[]
  options: EditorFindOptions
  query: string
  replacement: string
  viewRef: React.MutableRefObject<EditorView | null>
}): boolean {
  const view = viewRef.current
  if (!view || matches.length === 0) return false

  const changes = buildEditorFindReplacementChanges(matches, query, replacement, options)
  view.dispatch({ changes })
  view.focus()
  return true
}

interface RawEditorFindController {
  caseSensitive: boolean
  close: () => void
  findInputRef: React.RefObject<HTMLInputElement | null>
  handleBarKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  handleFindChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  handleFindKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
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

function useRawEditorFindController({
  doc,
  locale = 'en',
  onClose,
  onReplaceOpenChange,
  open,
  path,
  request,
  viewRef,
}: Omit<RawEditorFindBarProps, 'replaceOpen'>): RawEditorFindController {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [regex, setRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const options = useMemo<EditorFindOptions>(() => ({ caseSensitive, regex }), [caseSensitive, regex])
  const result = useMemo(() => findEditorMatches(doc, query, options), [doc, options, query])
  const clampedActiveIndex = clampEditorFindIndex(activeIndex, result.matches.length)
  const activeMatch = result.matches[clampedActiveIndex]
  const status = matchStatusText(locale, result.error, clampedActiveIndex, result.matches.length)
  const hasMatches = result.matches.length > 0 && !result.error

  useRequestFocus({ inputRef, onReplaceOpenChange, open, path, request })

  useEffect(() => {
    selectActiveEditorFindMatch(viewRef, open, activeMatch)
  }, [activeMatch, open, viewRef])

  const moveMatch = useCallback((direction: 1 | -1) => {
    setActiveIndex((current) => nextEditorFindIndex(current, result.matches.length, direction))
  }, [result.matches.length])
  const movePrevious = useCallback(() => moveMatch(-1), [moveMatch])
  const moveNext = useCallback(() => moveMatch(1), [moveMatch])
  const handleFindChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value)
    setActiveIndex(0)
  }, [])

  const close = useCallback(() => closeRawEditorFind(onClose, viewRef), [onClose, viewRef])

  const handleFindKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    handleRawEditorFindKeyDown(event, close, moveMatch)
  }, [close, moveMatch])

  const handleBarKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    handleRawEditorFindBarKeyDown(event, close)
  }, [close])

  const replaceCurrent = useCallback(() => {
    replaceCurrentEditorFindMatch({ activeMatch, options, query, replacement, viewRef })
  }, [activeMatch, options, query, replacement, viewRef])

  const replaceAll = useCallback(() => {
    if (replaceAllEditorFindMatches({
      matches: result.matches,
      options,
      query,
      replacement,
      viewRef,
    })) {
      setActiveIndex(0)
    }
  }, [options, query, replacement, result.matches, viewRef])

  return {
    caseSensitive,
    close,
    findInputRef: inputRef,
    handleBarKeyDown,
    handleFindChange,
    handleFindKeyDown,
    hasMatches,
    moveNext,
    movePrevious,
    query,
    regex,
    replaceAll,
    replaceCurrent,
    replacement,
    setReplacement,
    status,
    toggleCaseSensitive: () => setCaseSensitive((value) => !value),
    toggleRegex: () => setRegex((value) => !value),
  }
}

type FindControlsProps = Pick<
  RawEditorFindController,
  | 'caseSensitive'
  | 'close'
  | 'findInputRef'
  | 'handleFindChange'
  | 'handleFindKeyDown'
  | 'hasMatches'
  | 'moveNext'
  | 'movePrevious'
  | 'query'
  | 'regex'
  | 'status'
  | 'toggleCaseSensitive'
  | 'toggleRegex'
> & {
  locale: AppLocale
  onReplaceOpenChange: (open: boolean) => void
  replaceOpen: boolean
}

function FindControls({
  caseSensitive,
  close,
  findInputRef,
  handleFindChange,
  handleFindKeyDown,
  hasMatches,
  locale,
  moveNext,
  movePrevious,
  onReplaceOpenChange,
  query,
  regex,
  replaceOpen,
  status,
  toggleCaseSensitive,
  toggleRegex,
}: FindControlsProps) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={replaceOpen ? translate(locale, 'editor.find.hideReplace') : translate(locale, 'editor.find.showReplace')}
        title={replaceOpen ? translate(locale, 'editor.find.hideReplace') : translate(locale, 'editor.find.showReplace')}
        onClick={() => onReplaceOpenChange(!replaceOpen)}
      >
        <ChevronRight className={cn('transition-transform', replaceOpen && 'rotate-90')} />
      </Button>
      <Input
        ref={findInputRef}
        type="search"
        aria-label={translate(locale, 'editor.find.findLabel')}
        placeholder={translate(locale, 'editor.find.findPlaceholder')}
        value={query}
        onChange={handleFindChange}
        onKeyDown={handleFindKeyDown}
        className="h-7 min-w-[12rem] flex-1 rounded px-2 text-xs"
        data-testid="raw-editor-find-input"
      />
      <span
        className="min-w-[4.75rem] text-right text-xs text-muted-foreground"
        aria-live="polite"
        data-testid="raw-editor-find-count"
      >
        {status}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={translate(locale, 'editor.find.previousMatch')}
        title={translate(locale, 'editor.find.previousMatch')}
        disabled={!hasMatches}
        onClick={movePrevious}
      >
        <ChevronUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={translate(locale, 'editor.find.nextMatch')}
        title={translate(locale, 'editor.find.nextMatch')}
        disabled={!hasMatches}
        onClick={moveNext}
      >
        <ChevronDown />
      </Button>
      <Button
        type="button"
        variant={regex ? 'secondary' : 'ghost'}
        size="xs"
        aria-label={translate(locale, 'editor.find.regex')}
        aria-pressed={regex}
        title={translate(locale, 'editor.find.regex')}
        onClick={toggleRegex}
      >
        .*
      </Button>
      <Button
        type="button"
        variant={caseSensitive ? 'secondary' : 'ghost'}
        size="xs"
        aria-label={translate(locale, 'editor.find.matchCase')}
        aria-pressed={caseSensitive}
        title={translate(locale, 'editor.find.matchCase')}
        onClick={toggleCaseSensitive}
      >
        Aa
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={translate(locale, 'editor.find.close')}
        title={translate(locale, 'editor.find.close')}
        onClick={close}
      >
        <X />
      </Button>
    </div>
  )
}

type ReplaceControlsProps = Pick<
  RawEditorFindController,
  'hasMatches' | 'replaceAll' | 'replaceCurrent' | 'replacement' | 'setReplacement'
> & {
  locale: AppLocale
}

function ReplaceControls({
  hasMatches,
  locale,
  replaceAll,
  replaceCurrent,
  replacement,
  setReplacement,
}: ReplaceControlsProps) {
  return (
    <div className="ml-[1.875rem] flex min-w-0 items-center gap-1.5">
      <Input
        type="text"
        aria-label={translate(locale, 'editor.find.replaceLabel')}
        placeholder={translate(locale, 'editor.find.replacePlaceholder')}
        value={replacement}
        onChange={(event) => setReplacement(event.target.value)}
        className="h-7 min-w-[12rem] flex-1 rounded px-2 text-xs"
        data-testid="raw-editor-replace-input"
      />
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={!hasMatches}
        onClick={replaceCurrent}
      >
        {translate(locale, 'editor.find.replace')}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={!hasMatches}
        onClick={replaceAll}
      >
        {translate(locale, 'editor.find.replaceAll')}
      </Button>
    </div>
  )
}

export function RawEditorFindBar(props: RawEditorFindBarProps) {
  const { locale = 'en', onReplaceOpenChange, open, replaceOpen } = props
  const controller = useRawEditorFindController(props)
  const {
    caseSensitive,
    close,
    findInputRef,
    handleBarKeyDown,
    handleFindChange,
    handleFindKeyDown,
    hasMatches,
    moveNext,
    movePrevious,
    query,
    regex,
    replaceAll,
    replaceCurrent,
    replacement,
    setReplacement,
    status,
    toggleCaseSensitive,
    toggleRegex,
  } = controller

  if (!open) return null

  return (
    <div
      className="flex shrink-0 flex-col gap-1.5 border-b px-3 py-2"
      data-testid="raw-editor-find-bar"
      onKeyDown={handleBarKeyDown}
      style={{
        background: 'var(--surface-editor)',
        borderColor: 'var(--border-subtle)',
      }}
    >
      <FindControls
        caseSensitive={caseSensitive}
        close={close}
        findInputRef={findInputRef}
        handleFindChange={handleFindChange}
        handleFindKeyDown={handleFindKeyDown}
        hasMatches={hasMatches}
        locale={locale}
        moveNext={moveNext}
        movePrevious={movePrevious}
        onReplaceOpenChange={onReplaceOpenChange}
        query={query}
        regex={regex}
        replaceOpen={replaceOpen}
        status={status}
        toggleCaseSensitive={toggleCaseSensitive}
        toggleRegex={toggleRegex}
      />
      {replaceOpen && (
        <ReplaceControls
          hasMatches={hasMatches}
          locale={locale}
          replaceAll={replaceAll}
          replaceCurrent={replaceCurrent}
          replacement={replacement}
          setReplacement={setReplacement}
        />
      )}
    </div>
  )
}
