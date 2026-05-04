import { describe, expect, it } from 'vitest'
import {
  findByCollidingNotePath,
  joinVaultPath,
  normalizeVaultRelativePath,
  notePathFilename,
  notePathsCollide,
  notePathsMatch,
  vaultRelativePathLabel,
} from './notePathIdentity'

describe('notePathIdentity', () => {
  it('matches macOS /tmp aliases and separator variants without folding case', () => {
    expect(notePathsMatch('/private/tmp/vault/Project\\Active.md', '/tmp/vault/Project/Active.md')).toBe(true)
    expect(notePathsMatch('/tmp/vault/Project.md', '/tmp/vault/project.md')).toBe(false)
  })

  it('uses case-insensitive comparison only for collision checks', () => {
    expect(notePathsCollide('/private/tmp/vault/Project.md', '/tmp/vault/project.md')).toBe(true)
    expect(findByCollidingNotePath([{ path: '/tmp/vault/project.md' }], '/private/tmp/vault/Project.md')).toEqual({
      path: '/tmp/vault/project.md',
    })
  })

  it('normalizes relative folder paths and labels', () => {
    expect(normalizeVaultRelativePath(String.raw`/projects\active/`)).toBe('projects/active')
    expect(vaultRelativePathLabel(String.raw`/projects\active/`)).toBe('active')
  })

  it('joins vault paths without changing Windows verbatim roots', () => {
    const vaultPath = String.raw`\\?\C:\Users\alex\Tolaria`
    expect(joinVaultPath(vaultPath, 'note.md')).toBe(String.raw`\\?\C:\Users\alex\Tolaria/note.md`)
  })

  it('extracts filenames from slash or backslash paths', () => {
    expect(notePathFilename(String.raw`C:\Users\alex\Tolaria\note.md`)).toBe('note.md')
  })
})
