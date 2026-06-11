import type { TranslationKey } from '../lib/i18n'
import type { VaultEntry } from '../types'
import { findTypeDefinition, isMarkdownEntry, normalizeTypeName } from './typeDefinitions'

export type TypeDeleteBlockReason = 'type-in-use' | 'missing-type-document'

export type TypeDeleteRequest =
  | { kind: 'delete'; typeEntry: VaultEntry }
  | { kind: 'blocked'; reason: TypeDeleteBlockReason; instanceCount: number }

function isTypeInstance(entry: VaultEntry, typeKey: string): boolean {
  if (!isMarkdownEntry(entry) || entry.isA === 'Type') return false
  return normalizeTypeName({ type: entry.isA ?? '' }) === typeKey
}

function countTypeInstances(entries: VaultEntry[], typeName: string): number {
  const typeKey = normalizeTypeName({ type: typeName })
  if (!typeKey) return 0
  return entries.filter((entry) => isTypeInstance(entry, typeKey)).length
}

export function resolveTypeDeleteRequest(entries: VaultEntry[], typeName: string): TypeDeleteRequest {
  const instanceCount = countTypeInstances(entries, typeName)
  if (instanceCount > 0) {
    return { kind: 'blocked', reason: 'type-in-use', instanceCount }
  }

  const typeEntry = findTypeDefinition({ entries, type: typeName })
  if (!typeEntry) {
    return { kind: 'blocked', reason: 'missing-type-document', instanceCount: 0 }
  }

  return { kind: 'delete', typeEntry }
}

export function typeDeleteBlockedMessageKey(request: Extract<TypeDeleteRequest, { kind: 'blocked' }>): TranslationKey {
  if (request.reason === 'missing-type-document') return 'sidebar.typeDelete.missingDefinition'
  return request.instanceCount === 1
    ? 'sidebar.typeDelete.blockedInUseOne'
    : 'sidebar.typeDelete.blockedInUseMany'
}
