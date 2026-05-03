const SYSTEM_METADATA_ALIAS_GROUPS = {
  _archived: ['_archived', 'archived'],
  _favorite: ['_favorite'],
  _favorite_index: ['_favorite_index'],
  _icon: ['_icon', 'icon'],
  _list_properties_display: ['_list_properties_display'],
  _organized: ['_organized'],
  _order: ['_order', 'order'],
  _sidebar_label: ['_sidebar_label', 'sidebar_label', 'sidebar label'],
  _sort: ['_sort', 'sort'],
  _width: ['_width', 'width'],
} as const

const FRONTMATTER_ALIAS_GROUPS = {
  title: ['title'],
  type: ['type', 'is_a', 'is a'],
  aliases: ['aliases'],
  status: ['status'],
  color: ['color'],
  template: ['template'],
  view: ['view'],
  visible: ['visible'],
  belongs_to: ['belongs_to', 'belongs to'],
  related_to: ['related_to', 'related to'],
  ...SYSTEM_METADATA_ALIAS_GROUPS,
} as const

const CANONICAL_SYSTEM_METADATA_KEYS = Object.keys(SYSTEM_METADATA_ALIAS_GROUPS)
const CANONICAL_WRITE_KEYS = new Set(['type', ...CANONICAL_SYSTEM_METADATA_KEYS])

const CANONICAL_BY_ALIAS = new Map<string, string>()
const FRONTMATTER_CANONICAL_BY_ALIAS = new Map<string, string>()

for (const canonical of CANONICAL_SYSTEM_METADATA_KEYS) {
  for (const alias of SYSTEM_METADATA_ALIAS_GROUPS[canonical as keyof typeof SYSTEM_METADATA_ALIAS_GROUPS]) {
    CANONICAL_BY_ALIAS.set(alias, canonical)
  }
}

for (const canonical of Object.keys(FRONTMATTER_ALIAS_GROUPS)) {
  for (const alias of FRONTMATTER_ALIAS_GROUPS[canonical as keyof typeof FRONTMATTER_ALIAS_GROUPS]) {
    FRONTMATTER_CANONICAL_BY_ALIAS.set(normalizePropertyKey(alias), canonical)
  }
}

export function normalizePropertyKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, '_')
}

export function canonicalFrontmatterKey(key: string): string {
  const normalized = normalizePropertyKey(key)
  return FRONTMATTER_CANONICAL_BY_ALIAS.get(normalized) ?? normalized
}

export function frontmatterKeysMatch(left: string, right: string): boolean {
  return canonicalFrontmatterKey(left) === canonicalFrontmatterKey(right)
}

export function canonicalFrontmatterWriteKey(key: string): string {
  const canonical = canonicalFrontmatterKey(key)
  return CANONICAL_WRITE_KEYS.has(canonical) ? canonical : key
}

export function canonicalSystemMetadataKey(key: string): string {
  return canonicalFrontmatterKey(key)
}

export function isSystemMetadataKey(key: string): boolean {
  const canonical = canonicalFrontmatterKey(key)
  return canonical.startsWith('_') || CANONICAL_BY_ALIAS.has(normalizePropertyKey(key))
}

export function hasSystemMetadataKey(keys: Iterable<string>, canonicalKey: keyof typeof SYSTEM_METADATA_ALIAS_GROUPS): boolean {
  for (const key of keys) {
    if (canonicalFrontmatterKey(key) === canonicalKey) {
      return true
    }
  }
  return false
}
