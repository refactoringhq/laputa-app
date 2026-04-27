import { beforeEach, describe, expect, it, vi } from 'vitest'

async function loadHandlers() {
  vi.resetModules()
  return import('./mock-handlers')
}

describe('mockHandlers coverage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renames a note, updates its frontmatter title, and rewrites backlinks', async () => {
    const { mockHandlers } = await loadHandlers()
    const vaultPath = '/Users/mock/Test Vault'
    const oldPath = `${vaultPath}/old-note.md`
    const referencePath = `${vaultPath}/reference.md`

    mockHandlers.save_note_content({
      path: oldPath,
      content: '---\ntitle: Old Note\n---\n\n# Old Note',
    })
    mockHandlers.save_note_content({
      path: referencePath,
      content: 'See [[Old Note]] and [[old-note]].',
    })

    const result = mockHandlers.rename_note({
      vault_path: vaultPath,
      old_path: oldPath,
      new_title: 'New Title',
      old_title: 'Old Note',
    })

    const updatedContent = mockHandlers.get_all_content() as Record<string, string>

    expect(result).toEqual({
      new_path: `${vaultPath}/new-title.md`,
      updated_files: 1,
      failed_updates: 0,
    })
    expect(updatedContent[`${vaultPath}/new-title.md`]).toContain('title: New Title')
    expect(updatedContent[referencePath]).toBe('See [[new-title]] and [[new-title]].')
  })

  it('treats an unchanged title as a no-op rename', async () => {
    const { mockHandlers } = await loadHandlers()
    const vaultPath = '/Users/mock/Test Vault'
    const notePath = `${vaultPath}/same-title.md`

    mockHandlers.save_note_content({
      path: notePath,
      content: '---\ntitle: Same Title\n---\n',
    })

    expect(mockHandlers.rename_note({
      vault_path: vaultPath,
      old_path: notePath,
      new_title: 'Same Title',
      old_title: 'Same Title',
    })).toEqual({
      new_path: notePath,
      updated_files: 0,
      failed_updates: 0,
    })
  })

  it('validates filename-only renames and blocks collisions', async () => {
    const { mockHandlers } = await loadHandlers()
    const vaultPath = '/Users/mock/Test Vault'
    const sourcePath = `${vaultPath}/draft.md`

    mockHandlers.save_note_content({
      path: sourcePath,
      content: '# Draft',
    })
    mockHandlers.save_note_content({
      path: `${vaultPath}/duplicate.md`,
      content: '# Existing',
    })

    expect(() => mockHandlers.rename_note_filename({
      vault_path: vaultPath,
      old_path: sourcePath,
      new_filename_stem: '   ',
    })).toThrow('Invalid filename')

    expect(() => mockHandlers.rename_note_filename({
      vault_path: vaultPath,
      old_path: sourcePath,
      new_filename_stem: 'duplicate',
    })).toThrow('A note with that name already exists')
  })

  it('tracks saved files, deduplicates modified-file listings, and clears them on commit', async () => {
    const { mockHandlers } = await loadHandlers()

    mockHandlers.save_note_content({
      path: '/Users/luca/Laputa/26q1-laputa-app.md',
      content: '# Updated project note',
    })
    mockHandlers.save_note_content({
      path: '/Users/luca/Laputa/new-note.md',
      content: '# New note',
    })

    const modifiedBeforeCommit = mockHandlers.get_modified_files()
    const basePathCount = modifiedBeforeCommit.filter((entry) => entry.path === '/Users/luca/Laputa/26q1-laputa-app.md').length

    expect(basePathCount).toBe(1)
    expect(modifiedBeforeCommit.some((entry) => entry.path === '/Users/luca/Laputa/new-note.md')).toBe(true)

    expect(mockHandlers.git_commit({ message: 'Save everything' })).toContain('6 files changed')
    expect(mockHandlers.get_modified_files()).toEqual([])
  })

  it('searches mock content and slices pulse results to the requested limit', async () => {
    const { mockHandlers } = await loadHandlers()
    const projectPath = '/Users/luca/Laputa/26q1-laputa-app.md'

    mockHandlers.save_note_content({
      path: projectPath,
      content: '# Project Plan\n\nStrategic coverage improvements',
    })

    const search = mockHandlers.search_vault({ query: 'strategic', mode: 'content' })
    const pulse = mockHandlers.get_vault_pulse({ limit: 2 })

    expect(search.query).toBe('strategic')
    expect(search.results).toEqual([
      expect.objectContaining({
        path: projectPath,
        title: 'Build Laputa App',
      }),
    ])
    expect(pulse).toHaveLength(2)
    expect(pulse[0]?.shortHash).toBe('a1b2c3d')
  })

  it('applies setting defaults and keeps saved vault lists isolated from caller mutations', async () => {
    const { mockHandlers } = await loadHandlers()

    mockHandlers.save_settings({
      settings: {
        auto_pull_interval_minutes: undefined,
        autogit_enabled: true,
        autogit_idle_threshold_seconds: undefined,
        autogit_inactive_threshold_seconds: undefined,
        auto_advance_inbox_after_organize: true,
        telemetry_consent: true,
        crash_reporting_enabled: false,
        analytics_enabled: true,
        anonymous_id: 'anon-1',
        release_channel: 'alpha',
        ui_language: 'zh-Hans',
        default_ai_agent: 'codex',
      },
    })

    expect(mockHandlers.get_settings()).toEqual({
      auto_pull_interval_minutes: 5,
      autogit_enabled: true,
      autogit_idle_threshold_seconds: 90,
      autogit_inactive_threshold_seconds: 30,
      auto_advance_inbox_after_organize: true,
      telemetry_consent: true,
      crash_reporting_enabled: false,
      analytics_enabled: true,
      anonymous_id: 'anon-1',
      release_channel: 'alpha',
      theme_mode: null,
      ui_language: 'zh-Hans',
      default_ai_agent: 'codex',
    })

    const list = {
      vaults: [{ label: 'Work', path: '/work' }],
      active_vault: '/work',
    }
    mockHandlers.save_vault_list({ list })

    const savedList = mockHandlers.load_vault_list()
    savedList.vaults.push({ label: 'Leak', path: '/leak' })

    expect(mockHandlers.load_vault_list()).toEqual({
      vaults: [{ label: 'Work', path: '/work' }],
      active_vault: '/work',
    })
  })

  it('builds attachment paths for saved and copied images', async () => {
    const { mockHandlers } = await loadHandlers()
    vi.spyOn(Date, 'now').mockReturnValue(12345)

    expect(mockHandlers.save_image({
      vault_path: '/vault',
      filename: 'diagram.png',
      data: 'base64',
    })).toBe('/vault/attachments/12345-diagram.png')

    expect(mockHandlers.copy_image_to_vault({
      vault_path: '/vault',
      source_path: '/tmp/screenshot.jpg',
    })).toBe('/vault/attachments/12345-screenshot.jpg')
  })
})
