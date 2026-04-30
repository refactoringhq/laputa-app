import { beforeEach, describe, expect, it, vi } from 'vitest'

async function loadHandlers() {
  vi.resetModules()
  return import('./mock-handlers')
}

describe('mockHandlers additional coverage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns entry fallbacks, file history, diffs, and empty search results for empty queries', async () => {
    const { mockHandlers } = await loadHandlers()

    expect(mockHandlers.reload_vault_entry({ path: '/missing.md' })).toEqual(
      expect.objectContaining({
        path: '/missing.md',
        title: 'Unknown',
        filename: 'unknown.md',
      }),
    )

    expect(mockHandlers.get_file_history({ path: '/vault/notes/strategy.md' })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        shortHash: 'a1b2c3d',
        message: 'Update strategy with latest changes',
      }),
      expect.objectContaining({
        shortHash: 'm0n1o2p',
        message: 'Create strategy',
      }),
    ]))

    expect(mockHandlers.get_file_diff({ path: '/vault/old-draft.md' })).toContain('deleted file mode 100644')
    expect(mockHandlers.get_file_diff_at_commit({
      path: '/vault/notes/strategy.md',
      commitHash: 'abcdef1234567890',
    })).toContain('Updated paragraph at commit abcdef1.')

    expect(mockHandlers.search_vault({ query: '', mode: 'title' })).toEqual({
      results: [],
      elapsed_ms: 0,
      query: '',
      mode: 'title',
    })
  })

  it('renames a filename successfully and rewrites wikilinks that target the old path stem', async () => {
    const { mockHandlers } = await loadHandlers()
    const vaultPath = '/Users/mock/Test Vault'
    const sourcePath = `${vaultPath}/meeting-notes.md`
    const backlinkPath = `${vaultPath}/backlinks.md`

    mockHandlers.save_note_content({
      path: sourcePath,
      content: '# Meeting Notes',
    })
    mockHandlers.save_note_content({
      path: backlinkPath,
      content: 'Links: [[meeting-notes]] and [[Meeting Notes|alias]].',
    })

    expect(mockHandlers.rename_note_filename({
      vault_path: vaultPath,
      old_path: sourcePath,
      new_filename_stem: 'weekly-notes',
    })).toEqual({
      new_path: `${vaultPath}/weekly-notes.md`,
      updated_files: 1,
      failed_updates: 0,
    })

    const content = mockHandlers.get_all_content() as Record<string, string>
    expect(content[`${vaultPath}/weekly-notes.md`]).toBe('# Meeting Notes')
    expect(content[backlinkPath]).toBe('Links: [[weekly-notes]] and [[Meeting Notes|alias]].')
  })

  it('tracks remote state through create, clone, and add-remote flows', async () => {
    const { mockHandlers } = await loadHandlers()
    const emptyVaultPath = '/Users/mock/Documents/Brand New Vault'
    const clonedVaultPath = '/Users/mock/Documents/Cloned Vault'

    expect(mockHandlers.git_remote_status({ vaultPath: emptyVaultPath })).toEqual({
      branch: 'main',
      ahead: 0,
      behind: 0,
      hasRemote: true,
    })

    expect(mockHandlers.create_empty_vault({ targetPath: emptyVaultPath })).toBe(emptyVaultPath)
    expect(mockHandlers.git_remote_status({ vaultPath: emptyVaultPath })).toEqual({
      branch: 'main',
      ahead: 0,
      behind: 0,
      hasRemote: false,
    })

    expect(mockHandlers.git_add_remote({
      request: { vault_path: emptyVaultPath, remoteUrl: 'https://example.test/repo.git' },
    })).toEqual({
      status: 'connected',
      message: 'Remote connected. This vault now tracks origin/main.',
    })
    expect(mockHandlers.git_remote_status({ vault_path: emptyVaultPath })).toEqual({
      branch: 'main',
      ahead: 0,
      behind: 0,
      hasRemote: true,
    })

    expect(mockHandlers.create_getting_started_vault({ targetPath: clonedVaultPath })).toBe(clonedVaultPath)
    expect(mockHandlers.git_remote_status({ vaultPath: clonedVaultPath })).toEqual({
      branch: 'main',
      ahead: 0,
      behind: 0,
      hasRemote: false,
    })

    expect(mockHandlers.clone_repo({
      url: 'https://example.test/repo.git',
      local_path: clonedVaultPath,
    })).toBe(`Cloned to ${clonedVaultPath}`)
    expect(mockHandlers.git_remote_status({ vaultPath: clonedVaultPath })).toEqual({
      branch: 'main',
      ahead: 0,
      behind: 0,
      hasRemote: true,
    })
  })

  it('persists last-vault state, reports vault existence, and restores AI guidance state', async () => {
    const { mockHandlers } = await loadHandlers()

    expect(mockHandlers.get_last_vault_path()).toBe('/Users/mock/demo-vault-v2')
    expect(mockHandlers.set_last_vault_path({ path: '/Users/mock/Documents/Work' })).toBeNull()
    expect(mockHandlers.get_last_vault_path()).toBe('/Users/mock/Documents/Work')

    expect(mockHandlers.check_vault_exists({ path: '/tmp/demo-vault-v2-copy' })).toBe(true)
    expect(mockHandlers.check_vault_exists({ path: '/tmp/random-vault' })).toBe(false)

    expect(mockHandlers.get_vault_ai_guidance_status()).toEqual({
      agents_state: 'managed',
      claude_state: 'managed',
      gemini_state: 'managed',
      can_restore: false,
    })
    expect(mockHandlers.restore_vault_ai_guidance()).toEqual({
      agents_state: 'managed',
      claude_state: 'managed',
      gemini_state: 'managed',
      can_restore: false,
    })
    expect(mockHandlers.repair_vault()).toBe('Vault repaired')
  })

  it('persists theme mode through the mock settings backend', async () => {
    const { mockHandlers } = await loadHandlers()
    const settings = mockHandlers.get_settings()

    mockHandlers.save_settings({
      settings: {
        ...settings,
        theme_mode: 'dark',
      },
    })

    expect(mockHandlers.get_settings()).toEqual(expect.objectContaining({
      theme_mode: 'dark',
    }))
  })

  it('surfaces the simple command handlers for git, conflicts, trash, and telemetry', async () => {
    const { mockHandlers } = await loadHandlers()

    expect(mockHandlers.git_pull()).toEqual({
      status: 'up_to_date',
      message: 'Already up to date',
      updatedFiles: [],
      conflictFiles: [],
    })
    expect(mockHandlers.git_push()).toEqual({
      status: 'ok',
      message: 'Pushed to remote',
    })
    expect(mockHandlers.get_conflict_files()).toEqual([])
    expect(mockHandlers.get_conflict_mode()).toBe('none')
    expect(mockHandlers.purge_trash()).toEqual([])
    expect(mockHandlers.empty_trash()).toEqual([])
    expect(mockHandlers.delete_note({ path: '/vault/trash/me.md' })).toBe('/vault/trash/me.md')
    expect(mockHandlers.batch_delete_notes({ paths: ['/a.md', '/b.md'] })).toEqual(['/a.md', '/b.md'])
    expect(mockHandlers.batch_archive_notes({ paths: ['/a.md', '/b.md', '/c.md'] })).toBe(3)
    expect(mockHandlers.batch_trash_notes({ paths: ['/a.md', '/b.md'] })).toBe(2)
    expect(mockHandlers.migrate_is_a_to_type()).toBe(0)
    expect(mockHandlers.register_mcp_tools()).toBe('registered')
    expect(mockHandlers.check_mcp_status()).toBe('installed')
    expect(mockHandlers.copy_text_to_clipboard()).toBeNull()
    expect(mockHandlers.reinit_telemetry()).toBeNull()
    expect(mockHandlers.stream_claude_chat()).toBe('mock-session')
    expect(mockHandlers.stream_ai_agent()).toBeNull()
  })
})
