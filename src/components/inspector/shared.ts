import { wikilinkTarget, wikilinkDisplay } from '../../utils/wikilink'
import type { VaultEntry } from '../../types'
import { getTypeColor, getTypeLightColor } from '../../utils/typeColors'
import { getTypeIcon } from '../NoteItem'
import { findEntryByTarget } from '../../utils/wikilinkColors'

export function isWikilink(value: string): boolean {
  return /^\[\[.*\]\]$/.test(value)
}

export function resolveRef(ref: string, entries: VaultEntry[]): VaultEntry | undefined {
  const target = wikilinkTarget(ref)
  const byTitle = findEntryByTarget(entries, target)
  if (byTitle) return byTitle
  const lastSegment = target.split('/').pop()
  return entries.find((e) => {
    const stem = e.path.replace(/^.*\/Laputa\//, '').replace(/\.md$/, '')
    if (stem === target) return true
    return e.filename.replace(/\.md$/, '') === lastSegment
  })
}

export function entryStatusTitle(entry: VaultEntry | undefined): string | undefined {
  if (entry?.archived) return 'Archived'
  return undefined
}

function resolveRefLabel(ref: string, resolvedTitle: string | undefined): string {
  const displayLabel = wikilinkDisplay(ref)
  if (ref.includes('|')) return displayLabel
  return resolvedTitle ?? displayLabel
}

export function resolveRefProps(ref: string, entries: VaultEntry[], typeEntryMap: Record<string, VaultEntry>) {
  const resolved = resolveRef(ref, entries)
  const refType = resolved?.isA ?? null
  const typeEntry = refType ? Reflect.get(typeEntryMap, refType) : undefined
  const appearance = resolveRefAppearance(refType, typeEntry)
  return {
    label: resolveRefLabel(ref, resolved?.title),
    noteIcon: resolved?.icon ?? null,
    ...appearance,
    isArchived: resolved?.archived ?? false,
    target: wikilinkTarget(ref),
    title: entryStatusTitle(resolved),
  }
}

function resolveRefAppearance(refType: string | null, typeEntry: VaultEntry | undefined) {
  return {
    typeColor: getTypeColor(refType, typeEntry?.color),
    bgColor: getTypeLightColor(refType, typeEntry?.color),
    TypeIcon: getTypeIcon(refType, typeEntry?.icon),
  }
}
