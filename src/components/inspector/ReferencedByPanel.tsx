import { useMemo } from 'react'
import type { VaultEntry } from '../../types'
import { orderInverseRelationshipLabels, resolveInverseRelationshipLabel } from '../../utils/inverseRelationshipLabels'
import { humanizePropertyKey } from '../../utils/propertyLabels'
import { getTypeColor } from '../../utils/typeColors'
import { getTypeIcon } from '../NoteItem'
import { PROPERTY_PANEL_LABEL_CLASS_NAME } from '../propertyPanelLayout'
import { Separator } from '../ui/separator'
import { ActionTooltip } from '../ui/action-tooltip'
import { LinkButton } from './LinkButton'

export interface ReferencedByItem {
  entry: VaultEntry
  viaKey: string
}

export function ReferencedByPanel({ items, typeEntryMap, onNavigate }: {
  items: ReferencedByItem[]
  typeEntryMap: Record<string, VaultEntry>
  onNavigate: (target: string) => void
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, { entriesByPath: Map<string, VaultEntry>; inverseKeys: Set<string> }>()
    for (const item of items) {
      const label = resolveInverseRelationshipLabel(item.viaKey, item.entry)
      const group = map.get(label) ?? { entriesByPath: new Map<string, VaultEntry>(), inverseKeys: new Set<string>() }
      group.entriesByPath.set(item.entry.path, item.entry)
      group.inverseKeys.add(humanizePropertyKey(item.viaKey))
      map.set(label, group)
    }

    return orderInverseRelationshipLabels(map.keys())
      .map((label) => {
        const group = map.get(label)
        if (!group) return null

        return {
          entries: [...group.entriesByPath.values()],
          inverseKeys: [...group.inverseKeys].sort((left, right) => left.localeCompare(right)),
          label,
        }
      })
      .filter((group): group is { entries: VaultEntry[]; inverseKeys: string[]; label: string } => group !== null && group.entries.length > 0)
  }, [items])

  if (grouped.length === 0) return null

  return (
    <div className="referenced-by-panel flex flex-col gap-3">
      <Separator data-testid="derived-relationships-separator" />
      <div className="flex flex-col gap-3">
        {grouped.map(({ label, entries: groupEntries, inverseKeys }) => {
          const tooltip = `Derived inverse relationship, inverse of ${inverseKeys.join(' and ')}.`

          return (
            <div key={label} className="flex min-w-0 flex-col gap-1 px-1.5">
              <ActionTooltip copy={{ label: tooltip }} side="top" align="start">
                <span className={PROPERTY_PANEL_LABEL_CLASS_NAME} data-testid="derived-relationship-label">
                  {label}
                </span>
              </ActionTooltip>
              <div className="min-w-0 flex flex-col gap-0.5">
                {groupEntries.map((e) => {
                  const te = typeEntryMap[e.isA ?? '']
                  return (
                    <LinkButton
                      key={e.path}
                      label={e.title}
                      noteIcon={e.icon}
                      typeColor={getTypeColor(e.isA, te?.color)}
                      isArchived={e.archived}
                      onClick={() => onNavigate(e.title)}
                      title={e.archived ? 'Archived' : undefined}
                      TypeIcon={getTypeIcon(e.isA, te?.icon)}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
