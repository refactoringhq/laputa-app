/**
 * AI contextual chat — builds a structured context snapshot from the active note,
 * open tabs, vault metadata, and optional explicit note references.
 */

import type { VaultEntry } from '../types'
import { wikilinkTarget, resolveEntry } from './wikilink'
import { splitFrontmatter } from './wikilinks'

/** Extract only the body text from raw file content (strips YAML frontmatter). */
function extractBody(rawContent: string): string {
  const [, body] = splitFrontmatter(rawContent)
  return body.trim()
}

/** Resolve a link target string to a VaultEntry by matching title, aliases, or filename stem.
 *  Delegates to the unified resolveEntry for consistent matching. */
export function resolveTarget(target: string, entries: VaultEntry[]): VaultEntry | undefined {
  return resolveEntry(entries, target)
}

/** Collect first-degree linked notes from the active entry. */
export function collectLinkedEntries(
  active: VaultEntry,
  entries: VaultEntry[],
): VaultEntry[] {
  const seen = new Set<string>([active.path])
  const linked: VaultEntry[] = []

  const addTarget = (target: string) => {
    const entry = resolveTarget(target, entries)
    if (entry && !seen.has(entry.path)) {
      seen.add(entry.path)
      linked.push(entry)
    }
  }

  for (const target of active.outgoingLinks) {
    addTarget(target)
  }

  for (const refs of Object.values(active.relationships)) {
    for (const ref of refs) {
      addTarget(wikilinkTarget(ref))
    }
  }

  for (const ref of active.belongsTo) {
    addTarget(wikilinkTarget(ref))
  }
  for (const ref of active.relatedTo) {
    addTarget(wikilinkTarget(ref))
  }

  return linked
}

/** A note reference from the user's [[wikilink]] selection in the chat input. */
export interface NoteReference {
  title: string
  path: string
  type: string | null
}

/** Lightweight note summary for the context snapshot. */
export interface NoteListItem {
  path: string
  title: string
  type: string
}

/** Parameters for building the structured context snapshot. */
export interface ContextSnapshotParams {
  activeEntry: VaultEntry
  /** Direct content of the active note from the editor tab (most reliable source). */
  activeNoteContent?: string
  openTabs?: VaultEntry[]
  noteList?: NoteListItem[]
  noteListFilter?: { type: string | null; query: string }
  entries: VaultEntry[]
  references?: NoteReference[]
}

const MAX_ACTIVE_NOTE_BODY_CHARS = 24_000
const ACTIVE_NOTE_BODY_HEAD_CHARS = 16_000
const ACTIVE_NOTE_BODY_TAIL_CHARS = 4_000
const MAX_NOTE_LIST_ITEMS = 100

interface ActiveNoteBody {
  body: string
  bodyTruncated?: {
    shownChars: number
    totalChars: number
    strategy: 'head-tail'
  }
}

function isPresentValue(value: unknown): boolean {
  if (value === null) return false
  if (value === undefined) return false
  if (value === '') return false
  return true
}

function assignIfPresent(target: Record<string, unknown>, key: string, value: unknown): void {
  if (isPresentValue(value)) target[key] = value
}

function assignIfNonEmpty(target: Record<string, unknown>, key: string, values: unknown[]): void {
  if (values.length > 0) {
    target[key] = values
  }
}

function propertyString(value: unknown): string | undefined {
  if (!isPresentValue(value)) return undefined
  return typeof value === 'string' ? value : String(value)
}

function entryFrontmatter(e: VaultEntry): Record<string, unknown> {
  const fm: Record<string, unknown> = {}
  assignIfPresent(fm, 'type', e.isA)
  assignIfPresent(fm, 'status', e.status)
  assignIfPresent(fm, 'owner', propertyString(e.properties?.Owner ?? e.properties?.owner))
  assignIfPresent(fm, 'cadence', propertyString(e.properties?.Cadence ?? e.properties?.cadence))
  assignIfNonEmpty(fm, 'belongsTo', e.belongsTo)
  assignIfNonEmpty(fm, 'relatedTo', e.relatedTo)
  assignIfNonEmpty(fm, 'relationships', Object.keys(e.relationships))
  if (fm.relationships) fm.relationships = e.relationships
  return fm
}

function unavailableBodyInstruction(activeEntry: VaultEntry): string {
  return `[Content not available in editor context — use get_note("${activeEntry.path}") to read the full note (${activeEntry.wordCount} words)]`
}

function truncatedBodyInstruction(path: string, omittedChars: number): string {
  return [
    '[Active note body truncated by Tolaria to keep CLI agent context within provider limits.',
    `Omitted approximately ${omittedChars} characters from the middle.`,
    `Use get_note("${path}") to read the full note before making content-sensitive edits or summaries.]`,
  ].join(' ')
}

function compactActiveNoteBody(body: string, path: string): ActiveNoteBody {
  if (body.length <= MAX_ACTIVE_NOTE_BODY_CHARS) {
    return { body }
  }

  const head = body.slice(0, ACTIVE_NOTE_BODY_HEAD_CHARS).trimEnd()
  const tail = body.slice(-ACTIVE_NOTE_BODY_TAIL_CHARS).trimStart()
  const omittedChars = Math.max(0, body.length - ACTIVE_NOTE_BODY_HEAD_CHARS - ACTIVE_NOTE_BODY_TAIL_CHARS)

  return {
    body: `${head}\n\n${truncatedBodyInstruction(path, omittedChars)}\n\n${tail}`,
    bodyTruncated: {
      shownChars: ACTIVE_NOTE_BODY_HEAD_CHARS + ACTIVE_NOTE_BODY_TAIL_CHARS,
      totalChars: body.length,
      strategy: 'head-tail',
    },
  }
}

function activeNoteBody(activeEntry: VaultEntry, activeNoteContent?: string): ActiveNoteBody {
  const body = extractBody(activeNoteContent || '')
  if (!body && activeEntry.wordCount > 0) {
    return { body: unavailableBodyInstruction(activeEntry) }
  }
  return compactActiveNoteBody(body, activeEntry.path)
}

function activeNoteSnapshot(activeEntry: VaultEntry, activeNoteContent?: string): Record<string, unknown> {
  const bodySnapshot = activeNoteBody(activeEntry, activeNoteContent)
  const note: Record<string, unknown> = {
    path: activeEntry.path,
    title: activeEntry.title,
    type: activeEntry.isA ?? 'Note',
    frontmatter: entryFrontmatter(activeEntry),
    body: bodySnapshot.body,
    wordCount: activeEntry.wordCount,
  }
  assignIfPresent(note, 'bodyTruncated', bodySnapshot.bodyTruncated)
  return note
}

function appendOpenTabs(snapshot: Record<string, unknown>, activeEntry: VaultEntry, openTabs?: VaultEntry[]): void {
  const otherTabs = openTabs?.filter(t => t.path !== activeEntry.path)
  if (!otherTabs?.length) return

  snapshot.openTabs = otherTabs.map(t => ({
    path: t.path,
    title: t.title,
    type: t.isA ?? 'Note',
    frontmatter: entryFrontmatter(t),
  }))
}

function appendNoteList(snapshot: Record<string, unknown>, noteList?: NoteListItem[]): void {
  if (!noteList?.length) return

  snapshot.noteList = noteList.slice(0, MAX_NOTE_LIST_ITEMS)
  if (noteList.length > MAX_NOTE_LIST_ITEMS) {
    snapshot.noteListTruncated = { shown: MAX_NOTE_LIST_ITEMS, total: noteList.length }
  }
}

function hasNoteListFilter(noteListFilter?: { type: string | null; query: string }): boolean {
  return Boolean(noteListFilter?.type || noteListFilter?.query)
}

function appendReferencedNotes(snapshot: Record<string, unknown>, references?: NoteReference[]): void {
  if (!references?.length) return

  snapshot.referencedNotes = references.map(ref => ({
    path: ref.path,
    title: ref.title,
    type: ref.type ?? 'Note',
  }))
}

function vaultSummary(entries: VaultEntry[]): Record<string, unknown> {
  const types = new Set<string>()
  for (const e of entries) {
    if (e.isA) types.add(e.isA)
  }
  return {
    types: [...types].sort(),
    totalNotes: entries.length,
  }
}

function contextSnapshot(params: ContextSnapshotParams): Record<string, unknown> {
  const { activeEntry, activeNoteContent, openTabs, noteList, noteListFilter, entries, references } = params
  const snapshot: Record<string, unknown> = {
    activeNote: activeNoteSnapshot(activeEntry, activeNoteContent),
  }

  appendOpenTabs(snapshot, activeEntry, openTabs)
  appendNoteList(snapshot, noteList)
  if (hasNoteListFilter(noteListFilter)) snapshot.noteListFilter = noteListFilter
  snapshot.vault = vaultSummary(entries)
  appendReferencedNotes(snapshot, references)
  return snapshot
}

/** Build a structured context snapshot as a system prompt for Claude. */
export function buildContextSnapshot(params: ContextSnapshotParams): string {
  const snapshot = contextSnapshot(params)

  const preamble = [
    'You are an AI assistant integrated into Tolaria, a personal knowledge management app.',
    'The user is viewing a specific note. Use the structured context below to answer questions accurately.',
    'You can also use MCP tools to search, read, create, or edit notes in the vault.',
    'If the body field is empty or truncated, use get_note to read the full note from disk before content-sensitive edits or summaries.',
    'When you mention or reference a note by name, always use [[Note Title]] wikilink syntax so the user can click to open it.',
  ].join('\n')

  return `${preamble}\n\n## Context Snapshot\n\`\`\`json\n${JSON.stringify(snapshot, null, 2)}\n\`\`\``
}

/** Legacy: Build a contextual system prompt (text-based). */
export function buildContextualPrompt(
  active: VaultEntry,
  linkedEntries: VaultEntry[],
): string {
  const parts: string[] = [
    'You are an AI assistant integrated into Tolaria, a personal knowledge management app.',
    'The user is viewing a specific note. Use the note and its linked context to answer questions accurately.',
    'You can also use MCP tools to search, read, create, or edit notes in the vault.',
    '',
    `## Active Note: ${active.title}`,
    `Type: ${active.isA ?? 'Note'} | Path: ${active.path}`,
  ]

  if (linkedEntries.length > 0) {
    parts.push('', '## Linked Notes')
    for (const entry of linkedEntries) {
      parts.push(
        '',
        `### ${entry.title} (${entry.isA ?? 'Note'})`,
      )
    }
  }

  return parts.join('\n')
}
