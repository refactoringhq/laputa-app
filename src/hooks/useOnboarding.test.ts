import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_STORAGE_KEYS, LEGACY_APP_STORAGE_KEYS } from '../constants/appStorage'

const DEFAULT_GETTING_STARTED_PATH = '/mock/Documents/Getting Started'
const DEFAULT_PARENT_PATH = '/mock/Documents'
const MISSING_VAULT_PATH = '/vault/missing'

type MockArgs = Record<string, unknown> | undefined
type MockOverride = unknown | ((args?: MockArgs) => unknown)

// localStorage mock
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

const mockInvokeFn = vi.fn()

vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: (...args: unknown[]) => mockInvokeFn(...args),
}))

vi.mock('./useVaultSwitcher', () => ({}))

vi.mock('../utils/vault-dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/vault-dialog')>()
  return {
    ...actual,
    pickFolder: vi.fn(),
  }
})

import { NativeFolderPickerBlockedError, pickFolder } from '../utils/vault-dialog'
import { useOnboarding } from './useOnboarding'

function mockCommands(overrides: Record<string, MockOverride> = {}) {
  mockInvokeFn.mockImplementation(async (cmd: string, args?: MockArgs) => {
    const override = Reflect.get(overrides, cmd) as MockOverride | undefined
    if (typeof override === 'function') {
      return override(args)
    }
    if (override !== undefined) {
      return override
    }
    if (cmd === 'get_default_vault_path') return DEFAULT_GETTING_STARTED_PATH
    if (cmd === 'check_vault_exists') return false
    return null
  })
}

async function renderOnboarding(
  initialVaultPath = MISSING_VAULT_PATH,
  registerVault?: (
    vaultPath: string,
    label: string,
    options?: { verifyAvailability?: boolean },
  ) => Promise<void>,
  onTemplateVaultReady?: (vaultPath: string) => void,
) {
  const rendered = renderHook(() => useOnboarding(
    initialVaultPath,
    {
      registerVault,
      onVaultReady: onTemplateVaultReady
        ? (vaultPath, source) => {
            if (source === 'template') {
              onTemplateVaultReady(vaultPath)
            }
          }
        : undefined,
    },
  ))
  await waitFor(() => {
    expect(rendered.result.current.state.status).not.toBe('loading')
  })
  return rendered
}

async function expectStatus(
  result: { current: ReturnType<typeof useOnboarding> },
  status: 'ready' | 'welcome' | 'vault-missing',
) {
  await waitFor(() => {
    expect(result.current.state.status).toBe(status)
  })
}

async function expectCancelledPickerLeavesWelcome(
  action: (onboarding: ReturnType<typeof useOnboarding>) => Promise<void>,
) {
  mockCommands()
  vi.mocked(pickFolder).mockResolvedValue(null)

  const { result } = await renderOnboarding()

  await expectStatus(result, 'welcome')
  await act(async () => {
    await action(result.current)
  })

  expect(result.current.state.status).toBe('welcome')
}

describe('useOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('transitions to ready when the vault already exists', async () => {
    mockCommands({ check_vault_exists: true })

    const { result } = await renderOnboarding('/vault/path')

    expect(result.current.state).toEqual({ status: 'ready', vaultPath: '/vault/path' })
  })

  it('stays loading until the initial vault path has been resolved', async () => {
    localStorage.setItem(APP_STORAGE_KEYS.welcomeDismissed, '1')
    mockCommands({
      check_vault_exists: (args?: MockArgs) => (args as { path?: string } | undefined)?.path === '/vault/path',
    })

    const rendered = renderHook(
      ({ initialVaultPath, initialVaultResolved }) => useOnboarding(initialVaultPath, undefined, initialVaultResolved),
      { initialProps: { initialVaultPath: '', initialVaultResolved: false } },
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(rendered.result.current.state).toEqual({ status: 'loading' })

    rendered.rerender({ initialVaultPath: '/vault/path', initialVaultResolved: true })

    await waitFor(() => {
      expect(rendered.result.current.state).toEqual({ status: 'ready', vaultPath: '/vault/path' })
    })
  })

  it('shows the welcome screen when the vault does not exist', async () => {
    mockCommands()

    const { result } = await renderOnboarding()

    expect(result.current.state).toEqual({ status: 'welcome', defaultPath: DEFAULT_GETTING_STARTED_PATH })
  })

  it('shows vault-missing when a previously configured active vault is missing', async () => {
    localStorage.setItem(APP_STORAGE_KEYS.welcomeDismissed, '1')
    mockCommands({
      load_vault_list: {
        vaults: [{ label: 'Old Vault', path: '/vault/deleted' }],
        active_vault: '/vault/deleted',
        hidden_defaults: [],
      },
    })

    const { result } = await renderOnboarding('/vault/deleted')

    expect(result.current.state).toEqual({
      status: 'vault-missing',
      vaultPath: '/vault/deleted',
      defaultPath: DEFAULT_GETTING_STARTED_PATH,
    })
  })

  it('shows welcome instead of vault-missing when no persisted active vault matches the missing path', async () => {
    localStorage.setItem(APP_STORAGE_KEYS.welcomeDismissed, '1')
    mockCommands({
      load_vault_list: {
        vaults: [],
        active_vault: null,
        hidden_defaults: [],
      },
    })

    const { result } = await renderOnboarding('/vault/deleted')

    expect(result.current.state).toEqual({ status: 'welcome', defaultPath: DEFAULT_GETTING_STARTED_PATH })
  })

  it('clears the persisted active vault when the saved path no longer exists', async () => {
    localStorage.setItem(LEGACY_APP_STORAGE_KEYS.welcomeDismissed, '1')
    mockCommands({
      load_vault_list: {
        vaults: [{ label: 'Old Vault', path: '/vault/deleted' }],
        active_vault: '/vault/deleted',
        hidden_defaults: [],
      },
      save_vault_list: null,
    })

    const { result } = await renderOnboarding('/vault/deleted')

    await expectStatus(result, 'vault-missing')
    expect(mockInvokeFn).toHaveBeenCalledWith('save_vault_list', {
      list: {
        vaults: [{ label: 'Old Vault', path: '/vault/deleted' }],
        active_vault: null,
        hidden_defaults: [],
      },
    })
  })

  it('creates the template vault inside the selected parent folder', async () => {
    const onTemplateVaultReady = vi.fn()
    const registerVault = vi.fn().mockResolvedValue(undefined)
    mockCommands({
      create_getting_started_vault: (args?: MockArgs) => (args as { targetPath: string }).targetPath,
    })
    vi.mocked(pickFolder).mockResolvedValue(DEFAULT_PARENT_PATH)

    const { result } = await renderOnboarding(MISSING_VAULT_PATH, registerVault, onTemplateVaultReady)

    await expectStatus(result, 'welcome')
    await act(async () => {
      await result.current.handleCreateVault()
    })

    expect(result.current.state).toEqual({ status: 'ready', vaultPath: DEFAULT_GETTING_STARTED_PATH })
    expect(mockInvokeFn).toHaveBeenCalledWith('create_getting_started_vault', {
      targetPath: DEFAULT_GETTING_STARTED_PATH,
    })
    expect(registerVault).toHaveBeenCalledWith(
      DEFAULT_GETTING_STARTED_PATH,
      'Getting Started',
      { verifyAvailability: false },
    )
    expect(onTemplateVaultReady).toHaveBeenCalledWith(DEFAULT_GETTING_STARTED_PATH)
    expect(localStorage.getItem(APP_STORAGE_KEYS.welcomeDismissed)).toBe('1')
  })

  it('does nothing when the template folder picker is cancelled', async () => {
    await expectCancelledPickerLeavesWelcome(async (onboarding) => {
      await onboarding.handleCreateVault()
    })
    expect(mockInvokeFn).not.toHaveBeenCalledWith('create_getting_started_vault', expect.anything())
  })

  it('sets a friendly template error on clone failure', async () => {
    mockCommands({
      create_getting_started_vault: () => { throw 'git clone failed: fatal: unable to access' },
    })
    vi.mocked(pickFolder).mockResolvedValue(DEFAULT_PARENT_PATH)

    const { result } = await renderOnboarding()

    await expectStatus(result, 'welcome')
    await act(async () => {
      await result.current.handleCreateVault()
    })

    expect(result.current.error).toBe('Could not download Getting Started vault: git clone failed: fatal: unable to access')
    expect(result.current.state.status).toBe('welcome')
  })

  it('retries the last template clone without reopening the picker', async () => {
    let attempts = 0
    mockCommands({
      create_getting_started_vault: (args?: MockArgs) => {
        attempts += 1
        if (attempts === 1) {
          throw 'git clone failed: fatal: unable to access'
        }
        return (args as { targetPath: string }).targetPath
      },
    })
    vi.mocked(pickFolder).mockResolvedValue(DEFAULT_PARENT_PATH)

    const { result } = await renderOnboarding()

    await expectStatus(result, 'welcome')
    await act(async () => {
      await result.current.handleCreateVault()
    })

    expect(result.current.canRetryTemplate).toBe(true)
    await act(async () => {
      await result.current.retryCreateVault()
    })

    expect(result.current.state).toEqual({ status: 'ready', vaultPath: DEFAULT_GETTING_STARTED_PATH })
    expect(mockInvokeFn).toHaveBeenLastCalledWith('create_getting_started_vault', {
      targetPath: DEFAULT_GETTING_STARTED_PATH,
    })
  })

  it('creates a new empty vault and transitions to ready', async () => {
    mockCommands({
      create_empty_vault: (args?: MockArgs) => (args as { targetPath: string }).targetPath,
    })
    vi.mocked(pickFolder).mockResolvedValue('/new/vault')

    const { result } = await renderOnboarding()

    await expectStatus(result, 'welcome')
    await act(async () => {
      await result.current.handleCreateEmptyVault()
    })

    expect(result.current.state).toEqual({ status: 'ready', vaultPath: '/new/vault' })
    expect(localStorage.getItem(APP_STORAGE_KEYS.welcomeDismissed)).toBe('1')
  })

  it('does nothing when the empty-vault picker is cancelled', async () => {
    await expectCancelledPickerLeavesWelcome(async (onboarding) => {
      await onboarding.handleCreateEmptyVault()
    })
  })

  it('opens an existing folder and transitions to ready', async () => {
    const registerVault = vi.fn().mockResolvedValue(undefined)
    mockCommands()
    vi.mocked(pickFolder).mockResolvedValue('/selected/folder')

    const { result } = await renderOnboarding(MISSING_VAULT_PATH, registerVault)

    await expectStatus(result, 'welcome')
    await act(async () => {
      await result.current.handleOpenFolder()
    })

    expect(result.current.state).toEqual({ status: 'ready', vaultPath: '/selected/folder' })
    expect(registerVault).toHaveBeenCalledWith('/selected/folder', 'folder')
    expect(localStorage.getItem(APP_STORAGE_KEYS.welcomeDismissed)).toBe('1')
  })

  it('shows a visible error when vault registration fails during onboarding', async () => {
    const registerVault = vi.fn().mockRejectedValue(new Error('Failed to write vault list'))
    mockCommands()
    vi.mocked(pickFolder).mockResolvedValue('/selected/folder')

    const { result } = await renderOnboarding(MISSING_VAULT_PATH, registerVault)

    await expectStatus(result, 'welcome')
    await act(async () => {
      await result.current.handleOpenFolder()
    })

    expect(result.current.state).toEqual({ status: 'welcome', defaultPath: DEFAULT_GETTING_STARTED_PATH })
    expect(result.current.error).toBe('Could not open vault: Failed to write vault list')
  })

  it('does nothing when the open-folder picker is cancelled', async () => {
    await expectCancelledPickerLeavesWelcome(async (onboarding) => {
      await onboarding.handleOpenFolder()
    })
  })

  it('shows the restart-required picker message instead of crashing the welcome flow', async () => {
    mockCommands()
    vi.mocked(pickFolder).mockRejectedValue(new NativeFolderPickerBlockedError())

    const { result } = await renderOnboarding()

    await expectStatus(result, 'welcome')
    await act(async () => {
      await result.current.handleOpenFolder()
    })

    expect(result.current.error).toBe(
      'Tolaria needs a restart before macOS can open another folder picker. Restart to apply the downloaded update and try again.',
    )
    expect(result.current.state.status).toBe('welcome')
  })

  it('marks the welcome screen dismissed and keeps the initial vault path', async () => {
    mockCommands()

    const { result } = await renderOnboarding()

    await expectStatus(result, 'welcome')
    act(() => {
      result.current.handleDismiss()
    })

    expect(result.current.state).toEqual({ status: 'ready', vaultPath: MISSING_VAULT_PATH })
    expect(localStorage.getItem(APP_STORAGE_KEYS.welcomeDismissed)).toBe('1')
  })

  it('falls back to ready if onboarding commands fail', async () => {
    mockInvokeFn.mockRejectedValue(new Error('command not found'))

    const { result } = await renderOnboarding('/vault/path')

    expect(result.current.state).toEqual({ status: 'ready', vaultPath: '/vault/path' })
  })
})
