import { describe, expect, it } from 'vitest'
import {
  NOTE_FORMAT_SHEET,
  NOTE_FORMAT_TEXT,
  contentHasDisplayMetadata,
  contentHasSheetFormat,
  noteFormatFromContent,
} from './noteFormat'

describe('noteFormat', () => {
  it('defaults to text when _display is missing', () => {
    expect(noteFormatFromContent('---\ntype: Sheet\n---\nMetric,January')).toBe(NOTE_FORMAT_TEXT)
    expect(contentHasSheetFormat('---\ntype: Sheet\n---\nMetric,January')).toBe(false)
  })

  it('detects sheet display from _display frontmatter', () => {
    expect(noteFormatFromContent('---\ntype: Project\n_display: sheet\n---\nMetric,January')).toBe(NOTE_FORMAT_SHEET)
    expect(contentHasSheetFormat('---\n_display: sheet\n---\nMetric,January')).toBe(true)
    expect(contentHasDisplayMetadata('---\n_display: sheet\n---\nMetric,January')).toBe(true)
  })

  it('keeps reading the legacy _format field for internal prototype notes', () => {
    expect(noteFormatFromContent('---\ntype: Project\n_format: sheet\n---\nMetric,January')).toBe(NOTE_FORMAT_SHEET)
    expect(contentHasDisplayMetadata('---\n_format: sheet\n---\nMetric,January')).toBe(true)
  })

  it('prefers _display when both display markers are present', () => {
    expect(noteFormatFromContent('---\n_display: text\n_format: sheet\n---\nMetric,January')).toBe(NOTE_FORMAT_TEXT)
  })
})
