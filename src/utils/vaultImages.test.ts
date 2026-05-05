import { describe, it, expect, vi } from 'vitest'
import { resolveImageUrls, portableImageUrls } from './vaultImages'

let tauriMode = false

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: () => tauriMode,
}))

function assetUrl(path: string): string {
  return `asset://localhost/${encodeURIComponent(path)}`
}

function httpAssetUrl(path: string): string {
  return `http://asset.localhost/${encodeURIComponent(path)}`
}

describe('resolveImageUrls', () => {
  it('is a no-op outside Tauri', () => {
    tauriMode = false
    const markdown = '![alt](attachments/file.png)'

    expect(resolveImageUrls(markdown, '/vault')).toBe(markdown)
  })

  it('is a no-op when vaultPath is empty', () => {
    tauriMode = true
    const markdown = '![alt](attachments/file.png)'

    expect(resolveImageUrls(markdown, '')).toBe(markdown)
  })

  it('converts relative attachment paths to asset URLs', () => {
    tauriMode = true
    const markdown = '![screenshot](attachments/1776369786040-CleanShot_2026-04-16.png)'

    expect(resolveImageUrls(markdown, '/vault')).toBe(
      `![screenshot](${assetUrl('/vault/attachments/1776369786040-CleanShot_2026-04-16.png')})`,
    )
  })

  it('converts Windows relative attachment paths without mixed separators', () => {
    tauriMode = true
    const vaultPath = 'C:\\Users\\lnq12\\Documents\\tolaria-test\\Getting Started'
    const markdown = '![BlockNote image](attachments/1776508281809-CleanShot.png)'

    expect(resolveImageUrls(markdown, vaultPath)).toBe(
      `![BlockNote image](${assetUrl('C:\\Users\\lnq12\\Documents\\tolaria-test\\Getting Started\\attachments\\1776508281809-CleanShot.png')})`,
    )
  })

  it('leaves already-correct asset URLs unchanged', () => {
    tauriMode = true
    const url = assetUrl('/vault/attachments/file.png')
    const markdown = `![alt](${url})`

    expect(resolveImageUrls(markdown, '/vault')).toBe(markdown)
  })

  it('rewrites legacy asset URLs from a different vault', () => {
    tauriMode = true
    const legacyUrl = assetUrl('/Users/luca/Workspace/tolaria-getting-started/attachments/CleanShot.png')
    const markdown = `![CleanShot](${legacyUrl})`

    expect(resolveImageUrls(markdown, '/Users/john/Documents/Getting Started')).toBe(
      `![CleanShot](${assetUrl('/Users/john/Documents/Getting Started/attachments/CleanShot.png')})`,
    )
  })

  it('rewrites Windows legacy asset URLs from a different vault', () => {
    tauriMode = true
    const legacyUrl = httpAssetUrl('C:\\Users\\old\\Workspace\\tolaria-getting-started\\attachments\\CleanShot.png')
    const markdown = `![CleanShot](${legacyUrl})`

    expect(resolveImageUrls(markdown, 'C:\\Users\\john\\Documents\\Getting Started')).toBe(
      `![CleanShot](${assetUrl('C:\\Users\\john\\Documents\\Getting Started\\attachments\\CleanShot.png')})`,
    )
  })

  it('leaves already-correct http asset URLs unchanged', () => {
    tauriMode = true
    const url = httpAssetUrl('/vault/attachments/file.png')
    const markdown = `![alt](${url})`

    expect(resolveImageUrls(markdown, '/vault')).toBe(markdown)
  })

  it('leaves external URLs unchanged', () => {
    tauriMode = true
    const httpImage = '![logo](https://example.com/logo.png)'
    const dataImage = '![icon](data:image/png;base64,abc123)'

    expect(resolveImageUrls(httpImage, '/vault')).toBe(httpImage)
    expect(resolveImageUrls(dataImage, '/vault')).toBe(dataImage)
  })

  it('handles multiple images in one document', () => {
    tauriMode = true
    const markdown = `![a](${assetUrl('/old/attachments/a.png')})\n\n![b](attachments/b.png)`

    const result = resolveImageUrls(markdown, '/vault')

    expect(result).toContain(`![a](${assetUrl('/vault/attachments/a.png')})`)
    expect(result).toContain(`![b](${assetUrl('/vault/attachments/b.png')})`)
  })

  it('preserves alt text and title attributes', () => {
    tauriMode = true
    const markdown = '![my screenshot](attachments/file.png "starter vault")'

    expect(resolveImageUrls(markdown, '/vault')).toBe(
      `![my screenshot](${assetUrl('/vault/attachments/file.png')} "starter vault")`,
    )
  })

  it('skips unknown asset URLs without an attachments segment', () => {
    tauriMode = true
    const url = httpAssetUrl('/some/other/path/file.png')
    const markdown = `![alt](${url})`

    expect(resolveImageUrls(markdown, '/vault')).toBe(markdown)
  })

  it('matches markdown image URLs containing raw spaces', () => {
    tauriMode = true
    const markdown = '![shot](attachments/My Screenshot.png)'

    expect(resolveImageUrls(markdown, '/vault')).toBe(
      `![shot](${assetUrl('/vault/attachments/My Screenshot.png')})`,
    )
  })

  it('preserves title when URL contains spaces', () => {
    tauriMode = true
    const markdown = '![shot](attachments/My Screenshot.png "starter vault")'

    expect(resolveImageUrls(markdown, '/vault')).toBe(
      `![shot](${assetUrl('/vault/attachments/My Screenshot.png')} "starter vault")`,
    )
  })
})

describe('resolveImageUrls — note-relative paths', () => {
  it('resolves ./img/foo.png against the note directory', () => {
    tauriMode = true
    const notePath = '/vault/folder/note.md'
    const markdown = '![shot](./img/foo.png)'

    expect(resolveImageUrls(markdown, '/vault', notePath)).toBe(
      `![shot](${assetUrl('/vault/folder/img/foo.png')})`,
    )
  })

  it('resolves ../shared/img.png with parent traversal', () => {
    tauriMode = true
    const notePath = '/vault/folder/sub/note.md'
    const markdown = '![shot](../shared/img.png)'

    expect(resolveImageUrls(markdown, '/vault', notePath)).toBe(
      `![shot](${assetUrl('/vault/folder/shared/img.png')})`,
    )
  })

  it('resolves bare relative paths (no leading dot) against the note directory', () => {
    tauriMode = true
    const notePath = '/vault/folder/note.md'
    const markdown = '![shot](img/foo.png)'

    expect(resolveImageUrls(markdown, '/vault', notePath)).toBe(
      `![shot](${assetUrl('/vault/folder/img/foo.png')})`,
    )
  })

  it('resolves note-relative paths containing spaces', () => {
    tauriMode = true
    const notePath = '/vault/Doc/DocSolutionsCenter/MeetingReport_Kartiq_20260504.md'
    const markdown =
      '![shot](./img/MeetingReport_Kartiq_20260504/Screenshot 2026-05-04 alle 10.33.01.png)'

    expect(resolveImageUrls(markdown, '/vault', notePath)).toBe(
      `![shot](${assetUrl(
        '/vault/Doc/DocSolutionsCenter/img/MeetingReport_Kartiq_20260504/Screenshot 2026-05-04 alle 10.33.01.png',
      )})`,
    )
  })

  it('keeps attachments/ as vault-relative even when notePath is provided', () => {
    tauriMode = true
    const notePath = '/vault/folder/note.md'
    const markdown = '![shot](attachments/file.png)'

    expect(resolveImageUrls(markdown, '/vault', notePath)).toBe(
      `![shot](${assetUrl('/vault/attachments/file.png')})`,
    )
  })

  it('decodes %-encoded note-relative paths', () => {
    tauriMode = true
    const notePath = '/vault/folder/note.md'
    const markdown = '![shot](./img/My%20Photo.png)'

    expect(resolveImageUrls(markdown, '/vault', notePath)).toBe(
      `![shot](${assetUrl('/vault/folder/img/My Photo.png')})`,
    )
  })

  it('resolves note-relative paths on Windows', () => {
    tauriMode = true
    const notePath = 'C:\\Users\\a\\Vault\\folder\\note.md'
    const markdown = '![shot](./img/foo.png)'

    expect(resolveImageUrls(markdown, 'C:\\Users\\a\\Vault', notePath)).toBe(
      `![shot](${assetUrl('C:\\Users\\a\\Vault\\folder\\img\\foo.png')})`,
    )
  })

  it('resolves note-relative paths when the note is at the filesystem root', () => {
    // Edge case: notePath has its only separator at index 0.
    // Previously the directory was reported as the full notePath, so the
    // image filename ended up appended to the note's filename.
    tauriMode = true
    const notePath = '/note.md'
    const markdown = '![shot](./img/foo.png)'

    expect(resolveImageUrls(markdown, '/', notePath)).toBe(
      `![shot](${assetUrl('/img/foo.png')})`,
    )
  })

  it('resolves note-relative paths when notePath has no separator', () => {
    tauriMode = true
    const notePath = 'note.md'
    const markdown = '![shot](img/foo.png)'

    expect(resolveImageUrls(markdown, '/vault', notePath)).toBe(
      `![shot](${assetUrl('./img/foo.png')})`,
    )
  })
})

describe('portableImageUrls', () => {
  it('converts vault attachment asset URLs to relative paths', () => {
    const url = assetUrl('/vault/attachments/1776369786040-CleanShot.png')
    const markdown = `![screenshot](${url})`

    expect(portableImageUrls(markdown, '/vault')).toBe(
      '![screenshot](attachments/1776369786040-CleanShot.png)',
    )
  })

  it('converts legacy asset protocol attachment URLs to relative paths', () => {
    const url = httpAssetUrl('/vault/attachments/legacy.png')
    const markdown = `![screenshot](${url})`

    expect(portableImageUrls(markdown, '/vault')).toBe(
      '![screenshot](attachments/legacy.png)',
    )
  })

  it('converts Windows extended-length asset URLs to relative paths', () => {
    const url = httpAssetUrl('\\\\?\\C:\\Users\\lnq12\\Documents\\tolaria-test\\Getting Started\\attachments\\1777388840027-shot.png')
    const markdown = `![screenshot](${url})`

    expect(portableImageUrls(markdown, 'C:\\Users\\lnq12\\Documents\\tolaria-test\\Getting Started')).toBe(
      '![screenshot](attachments/1777388840027-shot.png)',
    )
  })

  it('is a no-op when vaultPath is empty', () => {
    const url = assetUrl('/vault/attachments/file.png')
    const markdown = `![alt](${url})`

    expect(portableImageUrls(markdown, '')).toBe(markdown)
  })

  it('unwraps asset URLs from other vaults to absolute filesystem paths', () => {
    // The internal asset:// scheme must never survive into saved markdown,
    // even for URLs that point outside the current vault. Falling back to the
    // decoded absolute path keeps the file readable and portable.
    const url = assetUrl('/other-vault/attachments/file.png')
    const markdown = `![alt](${url})`

    expect(portableImageUrls(markdown, '/vault')).toBe('![alt](/other-vault/attachments/file.png)')
  })

  it('leaves relative and external paths unchanged', () => {
    const relativeImage = '![alt](attachments/file.png)'
    const httpImage = '![logo](https://example.com/logo.png)'

    expect(portableImageUrls(relativeImage, '/vault')).toBe(relativeImage)
    expect(portableImageUrls(httpImage, '/vault')).toBe(httpImage)
  })

  it('handles multiple images', () => {
    const markdown = `![a](${assetUrl('/vault/attachments/a.png')})\n\n![b](${assetUrl('/vault/attachments/b.png')})`

    const result = portableImageUrls(markdown, '/vault')

    expect(result).toContain('![a](attachments/a.png)')
    expect(result).toContain('![b](attachments/b.png)')
  })

  it('preserves title attributes when converting to portable paths', () => {
    const markdown = `![shot](${assetUrl('/vault/attachments/a.png')} "starter vault")`

    expect(portableImageUrls(markdown, '/vault')).toBe('![shot](attachments/a.png "starter vault")')
  })

  it('falls back to absolute filesystem path when asset is outside vault and no notePath', () => {
    // Without a notePath we cannot compute a note-relative form. Returning the
    // decoded absolute filesystem path keeps the markdown free of the internal
    // asset:// scheme so it survives round-tripping and inspection by other tools.
    const url = assetUrl('/Users/me/external/photo.png')
    const markdown = `![alt](${url})`

    expect(portableImageUrls(markdown, '/vault')).toBe('![alt](/Users/me/external/photo.png)')
  })

  it('round-trips absolute filesystem paths outside the vault', () => {
    tauriMode = true
    const markdown = '![alt](/Users/me/external/photo.png)'

    expect(portableImageUrls(resolveImageUrls(markdown, '/vault'), '/vault')).toBe(markdown)
  })
})

describe('portableImageUrls — note-relative round-trip', () => {
  it('emits note-relative paths for images inside the note directory', () => {
    const url = assetUrl('/vault/folder/img/foo.png')
    const markdown = `![shot](${url})`
    const notePath = '/vault/folder/note.md'

    expect(portableImageUrls(markdown, '/vault', notePath)).toBe('![shot](./img/foo.png)')
  })

  it('prefers attachments/ when image is in vault attachments folder', () => {
    const url = assetUrl('/vault/attachments/foo.png')
    const markdown = `![shot](${url})`
    const notePath = '/vault/folder/note.md'

    expect(portableImageUrls(markdown, '/vault', notePath)).toBe('![shot](attachments/foo.png)')
  })

  it('emits ../ traversal when image is above the note directory', () => {
    const url = assetUrl('/vault/folder/shared/img.png')
    const markdown = `![shot](${url})`
    const notePath = '/vault/folder/sub/note.md'

    expect(portableImageUrls(markdown, '/vault', notePath)).toBe('![shot](../shared/img.png)')
  })

  it('preserves spaces in note-relative paths on round-trip', () => {
    const url = assetUrl('/vault/folder/img/My Photo.png')
    const markdown = `![shot](${url})`
    const notePath = '/vault/folder/note.md'

    expect(portableImageUrls(markdown, '/vault', notePath)).toBe('![shot](./img/My Photo.png)')
  })
})

describe('resolveImageUrls / portableImageUrls round-trip', () => {
  it('keeps relative attachment markdown stable', () => {
    tauriMode = true
    const markdown = '![shot](attachments/file.png)'

    expect(portableImageUrls(resolveImageUrls(markdown, '/vault'), '/vault')).toBe(markdown)
  })

  it('keeps note-relative markdown stable', () => {
    tauriMode = true
    const notePath = '/vault/folder/note.md'
    const markdown = '![shot](./img/foo.png)'

    expect(
      portableImageUrls(resolveImageUrls(markdown, '/vault', notePath), '/vault', notePath),
    ).toBe(markdown)
  })

  it('keeps note-relative markdown with spaces stable', () => {
    tauriMode = true
    const notePath = '/vault/folder/note.md'
    const markdown = '![shot](./img/My Photo.png)'

    expect(
      portableImageUrls(resolveImageUrls(markdown, '/vault', notePath), '/vault', notePath),
    ).toBe(markdown)
  })
})
