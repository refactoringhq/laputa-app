import { describe, expect, it, vi } from 'vitest'
import {
  isTauriAssetUrl,
  isVaultAttachmentUrl,
  portableAttachmentPathFromAnyAssetUrl,
  portableAttachmentPathFromCurrentVaultAssetUrl,
  portableAttachmentPathFromCurrentVaultPath,
  resolveVaultAttachmentPath,
  vaultAttachmentAssetUrl,
} from './vaultAttachments'

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`),
}))

function assetUrl(path: string): string {
  return `asset://localhost/${encodeURIComponent(path)}`
}

describe('resolveVaultAttachmentPath', () => {
  it('resolves relative attachment URLs inside the active vault', () => {
    expect(resolveVaultAttachmentPath({ url: 'attachments/report.pdf', vaultPath: '/vault' })).toBe(
      '/vault/attachments/report.pdf',
    )
    expect(resolveVaultAttachmentPath({ url: './attachments/report.pdf', vaultPath: '/vault' })).toBe(
      '/vault/attachments/report.pdf',
    )
  })

  it('resolves encoded Tauri asset URLs inside the active vault', () => {
    expect(
      resolveVaultAttachmentPath({
        url: 'asset://localhost/%2Fvault%2Fattachments%2Freport.pdf',
        vaultPath: '/vault',
      }),
    ).toBe('/vault/attachments/report.pdf')
  })

  it('rejects asset URLs outside the active vault', () => {
    expect(
      resolveVaultAttachmentPath({
        url: 'asset://localhost/%2Fother%2Fattachments%2Freport.pdf',
        vaultPath: '/vault',
      }),
    ).toBeNull()
  })

  it('rejects unsafe relative attachment traversal', () => {
    expect(
      resolveVaultAttachmentPath({
        url: 'attachments/../secret.pdf',
        vaultPath: '/vault',
      }),
    ).toBeNull()
  })

  it('keeps Windows vault paths case-insensitive and separator-safe', () => {
    expect(
      resolveVaultAttachmentPath({
        url: 'asset://localhost/C%3A%5CVault%5Cattachments%5CReport.pdf',
        vaultPath: 'c:\\vault',
      }),
    ).toBe('C:\\Vault\\attachments\\Report.pdf')
  })

  it('identifies attachment URLs before falling back to external link handling', () => {
    expect(isVaultAttachmentUrl({ url: 'attachments/report.pdf' })).toBe(true)
    expect(isVaultAttachmentUrl({ url: './attachments/report.pdf' })).toBe(true)
    expect(
      isVaultAttachmentUrl({
        url: 'asset://localhost/%2Fvault%2Fattachments%2Freport.pdf',
      }),
    ).toBe(true)
    expect(isVaultAttachmentUrl({ url: 'https://example.com/report.pdf' })).toBe(false)
  })
})

describe('vault attachment URL/path conversions', () => {
  it('builds asset URLs from portable attachment paths', () => {
    expect(
      vaultAttachmentAssetUrl({
        attachmentPath: 'attachments/shot.png',
        vaultPath: '/vault',
      }),
    ).toBe(assetUrl('/vault/attachments/shot.png'))
  })

  it('converts current-vault asset URLs back to portable attachment paths', () => {
    expect(
      portableAttachmentPathFromCurrentVaultAssetUrl({
        url: assetUrl('/vault/attachments/shot.png'),
        vaultPath: '/vault',
      }),
    ).toBe('attachments/shot.png')
  })

  it('converts current-vault attachment paths back to portable attachment paths', () => {
    expect(
      portableAttachmentPathFromCurrentVaultPath({
        path: '/vault/attachments/report.pdf',
        vaultPath: '/vault',
      }),
    ).toBe('attachments/report.pdf')
  })

  it('keeps Windows attachment path normalization case-insensitive', () => {
    expect(
      portableAttachmentPathFromCurrentVaultPath({
        path: 'C:\\Vault\\attachments\\Report.pdf',
        vaultPath: 'c:\\vault',
      }),
    ).toBe('attachments/Report.pdf')
  })

  it('rejects non-attachment paths inside the current vault', () => {
    expect(
      portableAttachmentPathFromCurrentVaultPath({
        path: '/vault/notes/report.pdf',
        vaultPath: '/vault',
      }),
    ).toBeNull()
  })

  it('extracts portable attachment paths from legacy asset URLs in another vault', () => {
    expect(
      portableAttachmentPathFromAnyAssetUrl({
        url: assetUrl('/old-vault/attachments/shot.png'),
      }),
    ).toBe('attachments/shot.png')
  })

  it('identifies every Tauri asset URL form used by editor media flows', () => {
    expect(isTauriAssetUrl({ url: 'asset://localhost/%2Fvault%2Fattachments%2Fshot.png' })).toBe(true)
    expect(isTauriAssetUrl({ url: 'http://asset.localhost/%2Fvault%2Fattachments%2Fshot.png' })).toBe(true)
    expect(isTauriAssetUrl({ url: 'asset:///vault/attachments/shot.png' })).toBe(true)
    expect(isTauriAssetUrl({ url: 'https://example.com/shot.png' })).toBe(false)
  })
})
