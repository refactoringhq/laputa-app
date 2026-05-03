import type { VaultEntry } from '../types'

export function toInlineWikilinkTarget(entry: VaultEntry): string {
  return entry.filename.replace(/\.md$/i, '')
}

export function chipToken(target: string): string {
  return `[[${target}]]`
}

export function normalizeInlineWikilinkValue(value: string): string {
  return value
    .replace(/\u00A0/g, ' ')
    .replace(/\u200B/g, '')
    .replace(/\r\n?/g, '\n')
}
