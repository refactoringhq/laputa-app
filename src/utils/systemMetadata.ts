const SYSTEM_METADATA_ALIAS_GROUPS = {
  _icon: ['_icon', 'icon'],
  _order: ['_order', 'order'],
  _sidebar_label: ['_sidebar_label', 'sidebar_label', 'sidebar label'],
  _sort: ['_sort', 'sort'],
  _width: ['_width', 'width'],
} as const

const CANONICAL_SYSTEM_METADATA_KEYS = Object.keys(SYSTEM_METADATA_ALIAS_GROUPS)

const CANONICAL_BY_ALIAS = new Map<string, string>()

for (const canonical of CANONICAL_SYSTEM_METADATA_KEYS) {
  for (const alias of SYSTEM_METADATA_ALIAS_GROUPS[canonical as keyof typeof SYSTEM_METADATA_ALIAS_GROUPS]) {
    CANONICAL_BY_ALIAS.set(alias, canonical)
  }
}

export function normalizePropertyKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, '_')
}

export function canonicalSystemMetadataKey(key: string): string {
  const normalized = normalizePropertyKey(key)
  return CANONICAL_BY_ALIAS.get(normalized) ?? normalized
}

export function isSystemMetadataKey(key: string): boolean {
  const normalized = normalizePropertyKey(key)
  return normalized.startsWith('_') || CANONICAL_BY_ALIAS.has(normalized)
}

export function hasSystemMetadataKey(keys: Iterable<string>, canonicalKey: keyof typeof SYSTEM_METADATA_ALIAS_GROUPS): boolean {
  for (const key of keys) {
    if (canonicalSystemMetadataKey(key) === canonicalKey) {
      return true
    }
  }
  return false
}
