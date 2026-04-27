import type { EditorView } from '@codemirror/view'
import { attachClickHandlers, enrichSuggestionItems } from './suggestionEnrichment'
import { deduplicateByPath, preFilterWikilinks } from './wikilinkSuggestions'
import type { VaultEntry } from '../types'
import type { WikilinkSuggestionItem } from '../components/WikilinkSuggestionMenu'

export interface RawEditorBaseItem {
  title: string
  aliases: string[]
  group: string
  entryType?: string | null
  entryTitle: string
  path: string
}

export interface RawEditorAutocompleteState {
  caretTop: number
  caretLeft: number
  selectedIndex: number
  items: WikilinkSuggestionItem[]
}

interface RawEditorAutocompleteParams {
  view: EditorView
  baseItems: RawEditorBaseItem[]
  query: string
  typeEntryMap: Record<string, VaultEntry>
  onInsertTarget: (target: string) => void
  vaultPath: string
}

/** Extract the wikilink query that the user is currently typing after [[ */
export function extractWikilinkQuery(text: string, cursor: number): string | null {
  const before = text.slice(0, cursor)
  const triggerIdx = before.lastIndexOf('[[')
  if (triggerIdx === -1) return null
  const afterTrigger = before.slice(triggerIdx + 2)
  // Don't trigger if the query contains ] (already closed) or a newline
  if (afterTrigger.includes(']') || afterTrigger.includes('\n')) return null
  return afterTrigger
}

export function replaceActiveWikilinkQuery(
  text: string,
  cursor: number,
  target: string,
): { text: string; cursor: number } | null {
  const before = text.slice(0, cursor)
  const triggerIdx = before.lastIndexOf('[[')
  if (triggerIdx === -1) return null
  const after = text.slice(cursor)
  return {
    text: `${text.slice(0, triggerIdx)}[[${target}]]${after}`,
    cursor: triggerIdx + target.length + 4,
  }
}

export function buildRawEditorBaseItems(entries: VaultEntry[]): RawEditorBaseItem[] {
  return deduplicateByPath(entries.map(entry => ({
    title: entry.title,
    aliases: [...new Set([entry.filename.replace(/\.md$/, ''), ...entry.aliases])],
    group: entry.isA || 'Note',
    entryType: entry.isA,
    entryTitle: entry.title,
    path: entry.path,
  })))
}

export function getRawEditorCursorCoords(view: EditorView): { top: number; left: number } | null {
  const pos = view.state.selection.main.head
  const coords = view.coordsAtPos(pos)
  if (!coords) return null
  return { top: coords.bottom, left: coords.left }
}

export function buildRawEditorAutocompleteState({
  view,
  baseItems,
  query,
  typeEntryMap,
  onInsertTarget,
  vaultPath,
}: RawEditorAutocompleteParams): RawEditorAutocompleteState | null {
  const coords = getRawEditorCursorCoords(view)
  if (!coords) return null

  const candidates = preFilterWikilinks(baseItems, query)
  const withHandlers = attachClickHandlers(candidates, onInsertTarget, vaultPath)
  const items = enrichSuggestionItems(withHandlers, query, typeEntryMap)

  return {
    caretTop: coords.top,
    caretLeft: coords.left,
    selectedIndex: 0,
    items,
  }
}

export function getRawEditorDropdownPosition(
  autocomplete: RawEditorAutocompleteState | null,
  maxHeight: number,
  viewport: { innerHeight: number; innerWidth: number },
): { top: number; left: number } {
  if (!autocomplete) return { top: 0, left: 0 }

  const dropdownBelow = autocomplete.caretTop + 20 + maxHeight <= viewport.innerHeight
  return {
    top: dropdownBelow ? autocomplete.caretTop + 4 : autocomplete.caretTop - maxHeight - 24,
    left: Math.min(autocomplete.caretLeft, viewport.innerWidth - 260),
  }
}

/** Basic YAML frontmatter structural checks. */
export function detectYamlError(content: string): string | null {
  if (!content.startsWith('---')) return null
  const rest = content.slice(3)
  const closeIdx = rest.search(/(?:^|\r?\n)---(?:\r?\n|$)/)
  if (closeIdx === -1) return 'Unclosed frontmatter block — add a closing --- line'
  const block = rest.slice(0, closeIdx)
  if (/^\t/m.test(block)) return 'YAML frontmatter contains tab indentation — use spaces'
  return null
}
