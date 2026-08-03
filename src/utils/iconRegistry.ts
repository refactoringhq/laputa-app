import type { ComponentType } from 'react'
import * as PhosphorIcons from '@phosphor-icons/react'
import { FileText, type IconProps } from '@phosphor-icons/react'

export type { IconProps }
export type IconEntry = { name: string; Icon: ComponentType<IconProps> }

// Exports from @phosphor-icons/react that are NOT selectable icons (context/base/providers).
const NON_ICON_EXPORTS = new Set(['IconContext', 'IconBase', 'SSRBase'])

function isExcludedExport(name: string): boolean {
  return (
    NON_ICON_EXPORTS.has(name) ||
    name.endsWith('Context') ||
    name.endsWith('Base') ||
    name.endsWith('Provider') ||
    !/^[A-Z]/.test(name)
  )
}

// Phosphor icons are forwardRef components (objects with a $$typeof marker) or functions.
function isIconComponent(value: unknown): boolean {
  if (typeof value === 'function') return true
  return typeof value === 'object' && value !== null && '$$typeof' in (value as Record<string, unknown>)
}

// PascalCase export name -> kebab-case (matches the format stored in vault frontmatter).
function pascalToKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-zA-Z])([0-9])/g, '$1-$2')
    .toLowerCase()
}

/**
 * The FULL Phosphor icon set (~1,500 icons), generated from the library's exports —
 * up from the previous hand-curated 288. Names are kebab-case for the `_icon:` field.
 * The type-customize popover filters this list by name, so the larger set stays searchable.
 */
export const ICON_OPTIONS: IconEntry[] = (() => {
  const seen = new Set<string>()
  const entries: IconEntry[] = []
  const all = Object.entries(PhosphorIcons)
  // @phosphor-icons/react exports every icon twice — `Acorn` and `AcornIcon`.
  // Prefer the bare name and drop the `*Icon` alias when its twin exists,
  // otherwise the picker shows ~1,500 duplicate entries.
  const bareNames = new Set(
    all.filter(([n, v]) => !n.endsWith('Icon') && isIconComponent(v)).map(([n]) => n),
  )
  for (const [exportName, value] of all) {
    if (isExcludedExport(exportName) || !isIconComponent(value)) continue
    if (exportName.endsWith('Icon') && bareNames.has(exportName.slice(0, -4))) continue
    const name = pascalToKebab(exportName)
    if (seen.has(name)) continue
    seen.add(name)
    entries.push({ name, Icon: value as ComponentType<IconProps> })
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name))
})()

const ICON_MAP: Record<string, ComponentType<IconProps>> = Object.fromEntries(
  ICON_OPTIONS.map((o) => [o.name, o.Icon]),
)

function normalizeIconName(name: string): string {
  return name.trim().toLowerCase().replace(/[_\s]+/g, '-')
}

/** Resolves a Phosphor icon name to its component, without a fallback. */
export function findIcon(name: string | null | undefined): ComponentType<IconProps> | null {
  if (!name) return null
  return ICON_MAP[normalizeIconName(name)] ?? null
}

/** Resolves a Phosphor icon name to its component, with fallback to FileText */
export function resolveIcon(name: string | null): ComponentType<IconProps> {
  return findIcon(name) ?? FileText
}
