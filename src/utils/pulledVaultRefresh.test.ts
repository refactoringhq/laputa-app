import { describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../types'
import { refreshPulledVaultState } from './pulledVaultRefresh'

function makeEntry(path: string, title = 'Test note'): VaultEntry {
  return {
    path,
    title,
    filename: path.split('/').pop() ?? 'note.md',
    snippet: '',
    wordCount: 0,
    outgoingLinks: [],
  } as VaultEntry
}

function makeOptions(overrides: Partial<Parameters<typeof refreshPulledVaultState>[0]> = {}) {
  const activeEntry = makeEntry('/vault/active.md', 'Active')
  return {
    activeTabPath: activeEntry.path,
    closeAllTabs: vi.fn(),
    hasUnsavedChanges: vi.fn(() => false),
    reloadFolders: vi.fn(),
    reloadVault: vi.fn().mockResolvedValue([activeEntry]),
    reloadViews: vi.fn(),
    replaceActiveTab: vi.fn().mockResolvedValue(undefined),
    updatedFiles: ['active.md'],
    vaultPath: '/vault',
    ...overrides,
  }
}

describe('refreshPulledVaultState', () => {
  it('reloads vault-derived data and refreshes the active note when pull updated it', async () => {
    const options = makeOptions()

    const entries = await refreshPulledVaultState(options)

    expect(entries).toHaveLength(1)
    expect(options.reloadVault).toHaveBeenCalledOnce()
    expect(options.reloadFolders).toHaveBeenCalledOnce()
    expect(options.reloadViews).toHaveBeenCalledOnce()
    expect(options.closeAllTabs).toHaveBeenCalledOnce()
    expect(options.replaceActiveTab).toHaveBeenCalledWith(entries[0])
  })

  it('keeps the active tab mounted when updates do not include the active note', async () => {
    const options = makeOptions({ updatedFiles: ['project/plan.md'] })

    await refreshPulledVaultState(options)

    expect(options.reloadVault).toHaveBeenCalledOnce()
    expect(options.closeAllTabs).not.toHaveBeenCalled()
    expect(options.replaceActiveTab).not.toHaveBeenCalled()
  })

  it('keeps the active tab mounted for full watcher refreshes with unknown changed files', async () => {
    const options = makeOptions({ updatedFiles: [] })

    await refreshPulledVaultState(options)

    expect(options.reloadVault).toHaveBeenCalledOnce()
    expect(options.closeAllTabs).not.toHaveBeenCalled()
    expect(options.replaceActiveTab).not.toHaveBeenCalled()
  })

  it('matches macOS /tmp and /private/tmp aliases when reloading the active tab entry', async () => {
    const activeEntry = makeEntry('/private/tmp/tolaria/active.md', 'Active')
    const options = makeOptions({
      activeTabPath: activeEntry.path,
      reloadVault: vi.fn().mockResolvedValue([activeEntry]),
      vaultPath: '/tmp/tolaria',
    })

    await refreshPulledVaultState(options)

    expect(options.closeAllTabs).toHaveBeenCalledOnce()
    expect(options.replaceActiveTab).toHaveBeenCalledWith(activeEntry)
  })

  it('skips tab replacement when the active note has unsaved edits', async () => {
    const options = makeOptions({
      hasUnsavedChanges: vi.fn((path: string) => path === '/vault/active.md'),
    })

    await refreshPulledVaultState(options)

    expect(options.replaceActiveTab).not.toHaveBeenCalled()
    expect(options.closeAllTabs).not.toHaveBeenCalled()
  })

  it('skips stale tab replacement when the active note changes during reload', async () => {
    let resolveReload!: (entries: VaultEntry[]) => void
    let currentActivePath: string | null = '/vault/active.md'
    const options = makeOptions({
      getActiveTabPath: () => currentActivePath,
      reloadVault: vi.fn(() => new Promise<VaultEntry[]>((resolve) => {
        resolveReload = resolve
      })),
    })

    const refresh = refreshPulledVaultState(options)
    await Promise.resolve()

    currentActivePath = '/vault/other.md'
    resolveReload([makeEntry('/vault/active.md', 'Active'), makeEntry('/vault/other.md', 'Other')])
    await refresh

    expect(options.replaceActiveTab).not.toHaveBeenCalled()
    expect(options.closeAllTabs).not.toHaveBeenCalled()
  })

  it('closes the tab when the pulled note disappeared from the reloaded vault', async () => {
    const options = makeOptions({
      reloadVault: vi.fn().mockResolvedValue([makeEntry('/vault/other.md', 'Other')]),
    })

    await refreshPulledVaultState(options)

    expect(options.replaceActiveTab).not.toHaveBeenCalled()
    expect(options.closeAllTabs).toHaveBeenCalledOnce()
  })
})
