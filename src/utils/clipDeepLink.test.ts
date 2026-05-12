import { describe, expect, it, vi } from 'vitest'
import { importClipDeepLinkFromClipboard, parseClipDeepLink } from './clipDeepLink'
import type { VaultEntry } from '../types'

describe('parseClipDeepLink', () => {
  it('accepts the v1 clipboard handoff URL with a vault-relative path', () => {
    expect(parseClipDeepLink('tolaria://clip/new?v=1&clipboard=1&path=Clippings%2FExample.md&title=Example')).toEqual({
      path: 'Clippings/Example.md',
      title: 'Example',
    })
  })

  it('rejects absolute and traversal paths from external URLs', () => {
    expect(parseClipDeepLink('tolaria://clip/new?v=1&clipboard=1&path=%2Ftmp%2Foutside.md')).toBeNull()
    expect(parseClipDeepLink('tolaria://clip/new?v=1&clipboard=1&path=C%3A%5CUsers%5Calex%5Coutside.md')).toBeNull()
    expect(parseClipDeepLink('tolaria://clip/new?v=1&clipboard=1&path=..%2Foutside.md')).toBeNull()
    expect(parseClipDeepLink('tolaria://clip/new?v=1&clipboard=1&path=Clippings%2F..%2Foutside.md')).toBeNull()
  })

  it('rejects URLs that try to put note bodies in query params', () => {
    expect(parseClipDeepLink('tolaria://clip/new?v=1&clipboard=1&path=Clippings%2FExample.md&markdown=%23+Body')).toBeNull()
    expect(parseClipDeepLink('tolaria://clip/new?v=1&clipboard=1&path=Clippings%2FExample.md&html=%3Cp%3EBody%3C%2Fp%3E')).toBeNull()
    expect(parseClipDeepLink('tolaria://clip/new?v=1&clipboard=1&path=Clippings%2FExample.md&content=Body')).toBeNull()
  })
})

const importedEntry = {
  path: '/vault/Clippings/Example.md',
  filename: 'Example.md',
  title: 'Example',
  isA: 'Clip',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: null,
  archived: false,
  modifiedAt: 1,
  createdAt: 1,
  fileSize: 42,
  snippet: 'Clip body',
  wordCount: 2,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  outgoingLinks: [],
  sidebarLabel: null,
  template: null,
  sort: null,
  view: null,
  visible: null,
  properties: {},
  organized: false,
  favorite: false,
  favoriteIndex: null,
  listPropertiesDisplay: [],
  hasH1: true,
} satisfies VaultEntry

function makeClipServices() {
  return {
    readClipboardText: vi.fn().mockResolvedValue('# Example\n\nClip body'),
    createNoteContent: vi.fn().mockResolvedValue(undefined),
    reloadVaultEntry: vi.fn().mockResolvedValue(importedEntry),
    reloadVault: vi.fn().mockResolvedValue(undefined),
    addEntry: vi.fn(),
    openTabWithContent: vi.fn(),
    setToastMessage: vi.fn(),
  }
}

describe('importClipDeepLinkFromClipboard', () => {
  it('reads clipboard markdown, creates the requested vault-relative file, refreshes, and opens it', async () => {
    const services = makeClipServices()

    await expect(importClipDeepLinkFromClipboard({
      rawUrl: 'tolaria://clip/new?v=1&clipboard=1&path=Clippings%2FExample.md&title=Example',
      vaultPath: '/vault',
      services,
    })).resolves.toBe('imported')

    expect(services.readClipboardText).toHaveBeenCalledOnce()
    expect(services.createNoteContent).toHaveBeenCalledWith('Clippings/Example.md', '# Example\n\nClip body', '/vault')
    expect(services.reloadVaultEntry).toHaveBeenCalledWith('Clippings/Example.md', '/vault')
    expect(services.reloadVault).toHaveBeenCalledOnce()
    expect(services.addEntry).toHaveBeenCalledWith(importedEntry)
    expect(services.openTabWithContent).toHaveBeenCalledWith(importedEntry, '# Example\n\nClip body')
  })

  it('rejects empty clipboard content before writing to disk', async () => {
    const services = makeClipServices()
    services.readClipboardText.mockResolvedValue('  \n  ')

    await expect(importClipDeepLinkFromClipboard({
      rawUrl: 'tolaria://clip/new?v=1&clipboard=1&path=Clippings%2FExample.md',
      vaultPath: '/vault',
      services,
    })).resolves.toBe('rejected')

    expect(services.createNoteContent).not.toHaveBeenCalled()
    expect(services.setToastMessage).toHaveBeenCalledWith(expect.stringContaining('clipboard is empty'))
  })

  it('rejects valid clip URLs when no vault is open', async () => {
    const services = makeClipServices()

    await expect(importClipDeepLinkFromClipboard({
      rawUrl: 'tolaria://clip/new?v=1&clipboard=1&path=Clippings%2FExample.md',
      vaultPath: '',
      services,
    })).resolves.toBe('rejected')

    expect(services.readClipboardText).not.toHaveBeenCalled()
    expect(services.createNoteContent).not.toHaveBeenCalled()
    expect(services.setToastMessage).toHaveBeenCalledWith(expect.stringContaining('Open a vault'))
  })
})
