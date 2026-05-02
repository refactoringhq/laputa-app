import { describe, expect, it } from 'vitest'
import { buildRecoveryFilename, hasFileIdentityChanged } from './staleSaveDetection'
import type { NoteFileIdentity } from './staleSaveDetection'

describe('staleSaveDetection', () => {
  it('detects changed mtime as stale', () => {
    const open: NoteFileIdentity = { path: '/vault/note.md', modifiedAt: 1000, fileSize: 200 }
    const current: NoteFileIdentity = { path: '/vault/note.md', modifiedAt: 2000, fileSize: 200 }
    expect(hasFileIdentityChanged(open, current)).toBe(true)
  })

  it('detects changed file size as stale', () => {
    const open: NoteFileIdentity = { path: '/vault/note.md', modifiedAt: 1000, fileSize: 200 }
    const current: NoteFileIdentity = { path: '/vault/note.md', modifiedAt: 1000, fileSize: 300 }
    expect(hasFileIdentityChanged(open, current)).toBe(true)
  })

  it('reports no change for identical identity', () => {
    const open: NoteFileIdentity = { path: '/vault/note.md', modifiedAt: 1000, fileSize: 200 }
    const current: NoteFileIdentity = { path: '/vault/note.md', modifiedAt: 1000, fileSize: 200 }
    expect(hasFileIdentityChanged(open, current)).toBe(false)
  })

  it('assumes safe when identity is null', () => {
    const open: NoteFileIdentity = { path: '/vault/note.md', modifiedAt: null, fileSize: null }
    const current: NoteFileIdentity = { path: '/vault/note.md', modifiedAt: 1000, fileSize: 200 }
    expect(hasFileIdentityChanged(open, current)).toBe(false)
  })

  it('builds recovery filename with timestamp', () => {
    const result = buildRecoveryFilename('/vault/my-note.md')
    expect(result).toMatch(/^\/vault\/my-note-recovered-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.md$/)
  })

  it('handles files without extension', () => {
    const result = buildRecoveryFilename('/vault/readme')
    expect(result).toMatch(/^\/vault\/readme-recovered-.*\.md$/)
  })
})
