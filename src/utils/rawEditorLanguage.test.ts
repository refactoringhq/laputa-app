import { describe, expect, it } from 'vitest'
import { rawEditorLanguageIdForPath } from './rawEditorLanguage'

describe('rawEditorLanguageIdForPath', () => {
  it.each([
    ['/vault/notes/example.md', 'markdown'],
    ['/vault/notes/example.markdown', 'markdown'],
    ['/vault/data/query.sql', 'sql'],
    ['/vault/data/config.yaml', 'yaml'],
    ['/vault/data/config.yml', 'yaml'],
    ['/vault/data/package.json', 'json'],
    ['/vault/data/settings.jsonc', 'json'],
    ['/vault/scripts/report.py', 'python'],
    ['/vault/scripts/report.pyw', 'python'],
  ])('maps %s to %s syntax highlighting', (path, languageId) => {
    expect(rawEditorLanguageIdForPath(path)).toBe(languageId)
  })

  it.each([
    '/vault/notes/plain.txt',
    '/vault/scripts/no-extension',
  ])('keeps unsupported text file %s plain', (path) => {
    expect(rawEditorLanguageIdForPath(path)).toBe('plain')
  })
})
