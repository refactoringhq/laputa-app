import type { FilterGroup, FilterNode, VaultEntry, ViewDefinition, ViewFile } from '../types'

type UnknownRecord = Record<string, unknown>

interface EntryNormalizationArgs {
  rawEntry: unknown
  vaultPath: string
  index: number
}

interface EntryPathArgs {
  explicitPath: string
  filename: string
  vaultPath: string
}

interface ViewNormalizationArgs {
  rawView: unknown
  index: number
}

interface ViewDefinitionArgs {
  rawDefinition: unknown
  filename: string
  index: number
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordFrom(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {}
}

function stringFrom(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nullableStringFrom(value: unknown): string | null {
  const text = stringFrom(value).trim()
  return text.length > 0 ? text : null
}

function numberFrom(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nullableNumberFrom(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function booleanFrom(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function nullableBooleanFrom(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function stringArrayFrom(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function hasUsablePath(rawEntry: unknown): boolean {
  const source = recordFrom(rawEntry)
  return typeof source.path === 'string' && source.path.trim().length > 0
}

function filenameFromPath(path: string): string {
  const normalizedPath = path.replace(/\\/g, '/')
  return normalizedPath.split('/').filter(Boolean).pop() ?? ''
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '')
}

function fallbackEntryFilename(source: UnknownRecord, index: number): string {
  return stringFrom(source.filename) || filenameFromPath(stringFrom(source.path)) || `untitled-${index + 1}.md`
}

function resolveEntryPath({ explicitPath, filename, vaultPath }: EntryPathArgs): string {
  if (explicitPath) return explicitPath
  const root = vaultPath.replace(/\/+$/, '')
  return root ? `${root}/${filename}` : filename
}

function normalizeRelationships(value: unknown): Record<string, string[]> {
  const source = recordFrom(value)
  const result: Record<string, string[]> = {}
  for (const [key, rawRefs] of Object.entries(source)) {
    const refs = stringArrayFrom(rawRefs)
    if (refs.length > 0) result[key] = refs
  }
  return result
}

function normalizeProperties(value: unknown): VaultEntry['properties'] {
  const source = recordFrom(value)
  const result: VaultEntry['properties'] = {}
  for (const [key, rawValue] of Object.entries(source)) {
    if (
      rawValue === null
      || typeof rawValue === 'string'
      || typeof rawValue === 'boolean'
      || (typeof rawValue === 'number' && Number.isFinite(rawValue))
    ) {
      result[key] = rawValue
    }
  }
  return result
}

function normalizeFileKind(value: unknown): VaultEntry['fileKind'] {
  if (value === 'markdown' || value === 'text' || value === 'binary') return value
  return undefined
}

function normalizeFilterGroup(value: unknown): FilterGroup {
  const source = recordFrom(value)
  if (Array.isArray(source.all)) return { all: source.all as FilterNode[] }
  if (Array.isArray(source.any)) return { any: source.any as FilterNode[] }
  return { all: [] }
}

function fallbackViewName(filename: string, index: number): string {
  const stem = stripExtension(filename).trim()
  return stem && stem !== `view-${index + 1}` ? stem : `View ${index + 1}`
}

function normalizeVaultEntryRecord({ rawEntry, vaultPath, index }: EntryNormalizationArgs): VaultEntry {
  const source = recordFrom(rawEntry)
  const filename = fallbackEntryFilename(source, index)
  const path = resolveEntryPath({
    explicitPath: stringFrom(source.path),
    filename,
    vaultPath,
  })
  const title = stringFrom(source.title).trim() || stripExtension(filename) || 'Untitled'
  const fileKind = normalizeFileKind(source.fileKind)

  const entry = {
    ...(source as Partial<VaultEntry>),
    path,
    filename,
    title,
    isA: nullableStringFrom(source.isA),
    aliases: stringArrayFrom(source.aliases),
    belongsTo: stringArrayFrom(source.belongsTo),
    relatedTo: stringArrayFrom(source.relatedTo),
    status: nullableStringFrom(source.status),
    archived: booleanFrom(source.archived),
    modifiedAt: nullableNumberFrom(source.modifiedAt),
    createdAt: nullableNumberFrom(source.createdAt),
    fileSize: numberFrom(source.fileSize),
    snippet: stringFrom(source.snippet),
    wordCount: numberFrom(source.wordCount),
    relationships: normalizeRelationships(source.relationships),
    icon: nullableStringFrom(source.icon),
    color: nullableStringFrom(source.color),
    order: nullableNumberFrom(source.order),
    sidebarLabel: nullableStringFrom(source.sidebarLabel),
    template: nullableStringFrom(source.template),
    sort: nullableStringFrom(source.sort),
    view: nullableStringFrom(source.view),
    visible: nullableBooleanFrom(source.visible),
    organized: booleanFrom(source.organized),
    favorite: booleanFrom(source.favorite),
    favoriteIndex: nullableNumberFrom(source.favoriteIndex),
    listPropertiesDisplay: stringArrayFrom(source.listPropertiesDisplay),
    outgoingLinks: stringArrayFrom(source.outgoingLinks),
    properties: normalizeProperties(source.properties),
    hasH1: booleanFrom(source.hasH1),
  } as VaultEntry

  if (fileKind) entry.fileKind = fileKind
  return entry
}

function normalizeViewDefinition({ rawDefinition, filename, index }: ViewDefinitionArgs): ViewDefinition {
  const definition = recordFrom(rawDefinition)
  const name = stringFrom(definition.name).trim() || fallbackViewName(filename, index)

  const normalized = {
    ...(definition as Partial<ViewDefinition>),
    name,
    icon: nullableStringFrom(definition.icon),
    color: nullableStringFrom(definition.color),
    sort: nullableStringFrom(definition.sort),
    filters: normalizeFilterGroup(definition.filters),
  } as ViewDefinition

  if ('order' in definition) normalized.order = nullableNumberFrom(definition.order)
  if ('listPropertiesDisplay' in definition) {
    normalized.listPropertiesDisplay = stringArrayFrom(definition.listPropertiesDisplay)
  }
  return normalized
}

function normalizeViewFile({ rawView, index }: ViewNormalizationArgs): ViewFile {
  const source = recordFrom(rawView)
  const filename = stringFrom(source.filename) || `view-${index + 1}.yml`

  return {
    filename,
    definition: normalizeViewDefinition({
      rawDefinition: source.definition,
      filename,
      index,
    }),
  }
}

export function normalizeVaultEntries(rawEntries: unknown, vaultPath: string): VaultEntry[] {
  if (!Array.isArray(rawEntries)) return []
  return rawEntries
    .filter(hasUsablePath)
    .map((rawEntry, index) => normalizeVaultEntry(rawEntry, vaultPath, index))
}

export function normalizeVaultEntry(rawEntry: unknown, vaultPath = '', index = 0): VaultEntry {
  return normalizeVaultEntryRecord({ rawEntry, vaultPath, index })
}

export function normalizeViewFiles(rawViews: unknown): ViewFile[] {
  if (!Array.isArray(rawViews)) return []
  return rawViews.map((rawView, index) => normalizeViewFile({ rawView, index }))
}
