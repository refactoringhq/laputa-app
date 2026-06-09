import { describe, expect, it } from 'vitest'
import type { VaultEntry } from '../types'
import {
  filePreviewKind,
  isExcalidrawEntry,
  isFilePreviewEntry,
  isImagePreviewEntry,
  isPdfPreviewEntry,
} from './filePreview'

type PreviewEntry = Pick<VaultEntry, 'fileKind' | 'filename' | 'path'>

const excalidrawEntry: PreviewEntry = {
  filename: 'diagram.excalidraw',
  path: 'sketches/diagram.excalidraw',
  fileKind: 'text',
}
const pngEntry: PreviewEntry = {
  filename: 'photo.png',
  path: 'media/photo.png',
  fileKind: 'binary',
}
const pdfEntry: PreviewEntry = {
  filename: 'report.pdf',
  path: 'docs/report.pdf',
  fileKind: 'binary',
}
const markdownEntry: PreviewEntry = {
  filename: 'note.md',
  path: 'note.md',
  fileKind: 'markdown',
}
const ymlEntry: PreviewEntry = {
  filename: 'config.yml',
  path: 'config.yml',
  fileKind: 'text',
}
const noExtensionEntry: PreviewEntry = {
  filename: 'Makefile',
  path: 'Makefile',
  fileKind: 'text',
}

describe('filePreviewKind', () => {
  it('returns excalidraw for .excalidraw files even when fileKind is text', () => {
    expect(filePreviewKind(excalidrawEntry)).toBe('excalidraw')
  })

  it('still returns binary preview kinds when fileKind is binary', () => {
    expect(filePreviewKind(pngEntry)).toBe('image')
    expect(filePreviewKind(pdfEntry)).toBe('pdf')
  })

  it('returns null for markdown files', () => {
    expect(filePreviewKind(markdownEntry)).toBeNull()
  })

  it('returns null when fileKind is text but extension is unknown', () => {
    expect(filePreviewKind(ymlEntry)).toBeNull()
  })

  it('returns null for entries with no extension', () => {
    expect(filePreviewKind(noExtensionEntry)).toBeNull()
  })
})

describe('preview type predicates', () => {
  it('isExcalidrawEntry only matches .excalidraw files', () => {
    expect(isExcalidrawEntry(excalidrawEntry)).toBe(true)
    expect(isExcalidrawEntry(pngEntry)).toBe(false)
    expect(isExcalidrawEntry(markdownEntry)).toBe(false)
  })

  it('isImagePreviewEntry and isPdfPreviewEntry remain unchanged for binary files', () => {
    expect(isImagePreviewEntry(pngEntry)).toBe(true)
    expect(isPdfPreviewEntry(pngEntry)).toBe(false)
    expect(isPdfPreviewEntry(pdfEntry)).toBe(true)
  })

  it('isFilePreviewEntry returns true for excalidraw and image entries', () => {
    expect(isFilePreviewEntry(excalidrawEntry)).toBe(true)
    expect(isFilePreviewEntry(pngEntry)).toBe(true)
    expect(isFilePreviewEntry(markdownEntry)).toBe(false)
  })
})
