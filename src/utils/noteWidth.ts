import type { NoteWidthMode } from '../types'
import { detectFrontmatterState } from './frontmatter'

export const DEFAULT_NOTE_WIDTH_MODE: NoteWidthMode = 'normal'

export function normalizeNoteWidthMode(value: unknown): NoteWidthMode | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim().toLowerCase()
  return normalized === 'normal' || normalized === 'wide' ? normalized : null
}

export function resolveNoteWidthMode(noteWidth: unknown, defaultWidth: unknown): NoteWidthMode {
  return normalizeNoteWidthMode(noteWidth)
    ?? normalizeNoteWidthMode(defaultWidth)
    ?? DEFAULT_NOTE_WIDTH_MODE
}

export function toggleNoteWidthMode(width: unknown): NoteWidthMode {
  return resolveNoteWidthMode(width, DEFAULT_NOTE_WIDTH_MODE) === 'wide' ? 'normal' : 'wide'
}

export function canPersistNoteWidthMode(content: string | null): boolean {
  const frontmatterState = detectFrontmatterState(content)
  return frontmatterState === 'valid' || frontmatterState === 'empty'
}
