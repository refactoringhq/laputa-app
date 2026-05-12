import { createElement, useMemo, useState, type ComponentType, type MouseEvent, type ReactNode, type SVGAttributes } from 'react'
import { Link } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import type { VaultEntry } from '../../types'
import { useDateDisplayFormat } from '../../hooks/useAppPreferences'
import { resolveNoteIcon } from '../../utils/noteIcon'
import { openExternalUrl } from '../../utils/url'
import { resolvePropertyChipValues, type PropertyChipValue } from './propertyChipValues'

function toChipTestId(propName: string, index: number): string {
  const slug = propName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `property-chip-${slug || 'value'}-${index}`
}

function RelationshipTypeIcon({
  typeIcon,
}: {
  typeIcon?: ComponentType<SVGAttributes<SVGSVGElement>> | null
}) {
  if (!typeIcon) return null
  return createElement(typeIcon, { 'aria-hidden': true, width: 11, height: 11, className: 'shrink-0' })
}

function renderResolvedNoteIcon(
  noteIcon: string | null | undefined,
  imageFailed: boolean,
  onImageError: () => void,
): ReactNode {
  const resolvedNoteIcon = resolveNoteIcon(noteIcon)

  if (resolvedNoteIcon.kind === 'emoji') {
    return (
      <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center leading-none" style={{ fontSize: 11, lineHeight: 1 }}>
        {resolvedNoteIcon.value}
      </span>
    )
  }

  if (resolvedNoteIcon.kind === 'phosphor') {
    return <resolvedNoteIcon.Icon aria-hidden="true" width={11} height={11} className="shrink-0" />
  }

  if (resolvedNoteIcon.kind !== 'image' || imageFailed) return null

  return (
    <img
      src={resolvedNoteIcon.src}
      alt=""
      aria-hidden="true"
      className="h-[11px] w-[11px] shrink-0 rounded-sm object-cover"
      onError={onImageError}
    />
  )
}

function PropertyChipIcon({
  noteIcon,
  typeIcon,
  tone,
}: {
  noteIcon?: string | null
  typeIcon?: ComponentType<SVGAttributes<SVGSVGElement>> | null
  tone: PropertyChipValue['tone']
}) {
  const [imageFailed, setImageFailed] = useState(false)

  if (tone === 'url') {
    return <Link aria-hidden="true" width={11} height={11} className="shrink-0" />
  }

  const noteIconElement = renderResolvedNoteIcon(noteIcon, imageFailed, () => setImageFailed(true))
  if (noteIconElement) return noteIconElement
  return <RelationshipTypeIcon typeIcon={typeIcon} />
}

async function handleChipClick(
  event: MouseEvent<HTMLSpanElement>,
  chip: PropertyChipValue,
  onOpenNote: (entry: VaultEntry, event: MouseEvent) => void,
) {
  event.preventDefault()
  event.stopPropagation()

  if (!event.metaKey || !chip.action) return

  if (chip.action.kind === 'note') {
    onOpenNote(chip.action.entry, event)
    return
  }

  await openExternalUrl(chip.action.url).catch((err) => console.warn('[link] Failed to open URL:', err))
}

export function PropertyChips({
  entry,
  displayProps,
  allEntries,
  typeEntryMap,
  onOpenNote,
}: {
  entry: VaultEntry
  displayProps: string[]
  allEntries: VaultEntry[]
  typeEntryMap: Record<string, VaultEntry>
  onOpenNote: (entry: VaultEntry, event: MouseEvent) => void
}) {
  const dateDisplayFormat = useDateDisplayFormat()
  const chips = useMemo(() => {
    const result: { key: string; values: PropertyChipValue[] }[] = []
    for (const prop of displayProps) {
      const values = resolvePropertyChipValues(entry, prop, { allEntries, typeEntryMap, dateDisplayFormat })
      if (values.length > 0) result.push({ key: prop, values })
    }
    return result
  }, [allEntries, dateDisplayFormat, displayProps, entry, typeEntryMap])

  if (chips.length === 0) return null

  return (
    <div className="mt-1 flex flex-wrap gap-1" data-testid="property-chips">
      {chips.map(({ key, values }) =>
        values.map((chip, index) => (
          <span
            key={`${key}-${index}`}
            className={cn(
              'inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground',
              chip.action && 'cursor-pointer',
            )}
            style={chip.style}
            onClick={(event) => { void handleChipClick(event, chip, onOpenNote) }}
            data-testid={toChipTestId(key, index)}
          >
            <PropertyChipIcon noteIcon={chip.noteIcon} typeIcon={chip.typeIcon} tone={chip.tone} />
            <span className="truncate whitespace-nowrap">{chip.label}</span>
          </span>
        ))
      )}
    </div>
  )
}
