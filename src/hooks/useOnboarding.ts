import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import { APP_STORAGE_KEYS, LEGACY_APP_STORAGE_KEYS, getAppStorageItem } from '../constants/appStorage'
import {
  buildGettingStartedVaultPath,
  formatGettingStartedCloneError,
  labelFromPath,
} from '../utils/gettingStartedVault'
import { formatFolderPickerActionError, pickFolder } from '../utils/vault-dialog'

type OnboardingState =
  | { status: 'loading' }
  | { status: 'welcome'; defaultPath: string }
  | { status: 'vault-missing'; vaultPath: string; defaultPath: string }
  | { status: 'ready'; vaultPath: string }

type CreatingAction = 'template' | 'empty' | null
type ReadyVaultSource = 'template' | 'empty' | 'existing'
type OnVaultReady = (vaultPath: string, source: ReadyVaultSource) => void
type RegisterVault = (
  vaultPath: string,
  label: string,
  options?: { verifyAvailability?: boolean; providerType?: string; providerRoot?: string },
) => Promise<void>
type SetError = Dispatch<SetStateAction<string | null>>
type SetCreatingAction = Dispatch<SetStateAction<CreatingAction>>

interface TemplateVaultCreationOptions {
  setState: Dispatch<SetStateAction<OnboardingState>>
  setCreatingAction: SetCreatingAction
  setError: SetError
  setLastTemplatePath: Dispatch<SetStateAction<string | null>>
  registerVault?: RegisterVault
  onVaultReady?: OnVaultReady
}

interface OnboardingOptions {
  onVaultReady?: OnVaultReady
  registerVault?: RegisterVault
}

interface ReadyVaultHandlerOptions {
  onVaultReady?: OnVaultReady
  registerVault?: RegisterVault
  setError: SetError
  setState: Dispatch<SetStateAction<OnboardingState>>
}

interface CreateEmptyVaultHandlerOptions extends ReadyVaultHandlerOptions {
  setCreatingAction: SetCreatingAction
}

function tauriCall<T>(command: string, args: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args)
}

interface PersistedVaultList {
  vaults?: Array<{ label: string; path: string }>
  active_vault?: string | null
  hidden_defaults?: string[]
}

function wasDismissed(): boolean {
  try {
    return getAppStorageItem('welcomeDismissed') === '1'
  } catch {
    return false
  }
}

function markDismissed(): void {
  try {
    localStorage.setItem(APP_STORAGE_KEYS.welcomeDismissed, '1')
    localStorage.removeItem(LEGACY_APP_STORAGE_KEYS.welcomeDismissed)
  } catch {
    // localStorage may be unavailable in some contexts
  }
}

async function clearMissingActiveVault(missingPath: string): Promise<boolean> {
  try {
    const list = await tauriCall<PersistedVaultList>('load_vault_list', {})
    if (!list || list.active_vault !== missingPath) return false
    await tauriCall('save_vault_list', {
      list: {
        vaults: list.vaults ?? [],
        active_vault: null,
        hidden_defaults: list.hidden_defaults ?? [],
      },
    })
    return true
  } catch {
    // Best effort only — onboarding should still proceed
    return false
  }
}

function markVaultReady(
  setState: Dispatch<SetStateAction<OnboardingState>>,
  vaultPath: string,
) {
  markDismissed()
  setState({ status: 'ready', vaultPath })
}

function formatOnboardingRegistrationError({
  action,
  err,
}: {
  action: string
  err: unknown
}): string {
  const message =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : `${err}`

  return message ? `${action}: ${message}` : action
}

async function registerVaultSelection(
  registerVault: RegisterVault | undefined,
  vaultPath: string,
  options?: { verifyAvailability?: boolean; providerType?: string; providerRoot?: string },
): Promise<void> {
  if (!registerVault) {
    return
  }

  const label = labelFromPath(vaultPath)
  if (options) {
    await registerVault(vaultPath, label, options)
    return
  }

  await registerVault(vaultPath, label)
}

async function pickFolderWithOnboardingError({
  action,
  setError,
  title,
}: {
  action: string
  setError: SetError
  title: string
}): Promise<string | null> {
  setError(null)

  try {
    return await pickFolder(title)
  } catch (err) {
    setError(formatFolderPickerActionError(action, err))
    return null
  }
}

function useTemplateVaultCreation(
  options: TemplateVaultCreationOptions,
) {
  return useCallback(async (targetPath: string) => {
    options.setCreatingAction('template')
    options.setError(null)
    options.setLastTemplatePath(targetPath)

    try {
      const vaultPath = await tauriCall<string>('create_getting_started_vault', { targetPath })
      try {
        await registerVaultSelection(options.registerVault, vaultPath, { verifyAvailability: false })
      } catch (err) {
        options.setError(formatOnboardingRegistrationError({
          action: 'Could not register the Getting Started vault',
          err,
        }))
        return
      }
      markVaultReady(options.setState, vaultPath)
      options.onVaultReady?.(vaultPath, 'template')
    } catch (err) {
      options.setError(formatGettingStartedCloneError(err))
    } finally {
      options.setCreatingAction(null)
    }
  }, [options])
}

function useCreateVaultHandler(
  createTemplateVault: (targetPath: string) => Promise<void>,
  setError: SetError,
) {
  return useCallback(async () => {
    const parentPath = await pickFolderWithOnboardingError({
      action: 'Could not choose a parent folder',
      setError,
      title: 'Choose a parent folder for the Getting Started vault',
    })
    if (!parentPath) return

    await createTemplateVault(buildGettingStartedVaultPath(parentPath))
  }, [createTemplateVault, setError])
}

function useCreateEmptyVaultHandler(
  options: CreateEmptyVaultHandlerOptions,
) {
  return useCallback(async (providerType?: string) => {
    const isIcloud = providerType === 'icloud-drive'
    const path = await pickFolderWithOnboardingError({
      action: 'Could not choose where to create your vault',
      setError: options.setError,
      title: isIcloud ? 'Choose where to create your iCloud vault' : 'Choose where to create your vault',
    })
    if (!path) return

    try {
      options.setCreatingAction('empty')
      const vaultPath = await tauriCall<string>('create_empty_vault', { targetPath: path })
      try {
        await registerVaultSelection(options.registerVault, vaultPath, {
          verifyAvailability: false,
          providerType: providerType ?? 'local-folder',
          providerRoot: vaultPath,
        })
      } catch (err) {
        options.setError(formatOnboardingRegistrationError({
          action: 'Could not register the new vault',
          err,
        }))
        return
      }
      markVaultReady(options.setState, vaultPath)
      options.onVaultReady?.(vaultPath, 'empty')
    } catch (err) {
      options.setError(typeof err === 'string' ? err : `Failed to create vault: ${err}`)
    } finally {
      options.setCreatingAction(null)
    }
  }, [options])
}

function useOpenFolderHandler(
  options: ReadyVaultHandlerOptions,
) {
  return useCallback(async () => {
    const path = await pickFolderWithOnboardingError({
      action: 'Failed to open folder',
      setError: options.setError,
      title: 'Open vault folder',
    })
    if (!path) return

    try {
      await registerVaultSelection(options.registerVault, path)
    } catch (err) {
      options.setError(formatOnboardingRegistrationError({
        action: 'Could not open vault',
        err,
      }))
      return
    }

    markVaultReady(options.setState, path)
    options.onVaultReady?.(path, 'existing')
  }, [options])
}

export function useOnboarding(
  initialVaultPath: string,
  options: OnboardingOptions = {},
  initialVaultResolved = true,
) {
  const [state, setState] = useState<OnboardingState>({ status: 'loading' })
  const [creatingAction, setCreatingAction] = useState<CreatingAction>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastTemplatePath, setLastTemplatePath] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!initialVaultResolved) {
      return () => { cancelled = true }
    }

    async function check() {
      try {
        const defaultPath = await tauriCall<string>('get_default_vault_path', {})
        const exists = await tauriCall<boolean>('check_vault_exists', { path: initialVaultPath })

        if (cancelled) return

        if (exists) {
          setState({ status: 'ready', vaultPath: initialVaultPath })
          return
        }

        const missingWasPersistedActiveVault = await clearMissingActiveVault(initialVaultPath)
        if (cancelled) return

        if (wasDismissed() && missingWasPersistedActiveVault) {
          // Only show vault-missing when a previously selected vault path truly disappeared.
          setState({ status: 'vault-missing', vaultPath: initialVaultPath, defaultPath })
        } else {
          setState({ status: 'welcome', defaultPath })
        }
      } catch {
        // If commands fail (e.g. mock mode), just proceed
        if (!cancelled) setState({ status: 'ready', vaultPath: initialVaultPath })
      }
    }

    check()
    return () => { cancelled = true }
  }, [initialVaultPath, initialVaultResolved])

  const createTemplateVault = useTemplateVaultCreation({
    setState,
    setCreatingAction,
    setError,
    setLastTemplatePath,
    registerVault: options.registerVault,
    onVaultReady: options.onVaultReady,
  })

  const handleCreateVault = useCreateVaultHandler(createTemplateVault, setError)

  const retryCreateVault = useCallback(async () => {
    if (!lastTemplatePath) return
    await createTemplateVault(lastTemplatePath)
  }, [createTemplateVault, lastTemplatePath])

  const handleCreateEmptyVault = useCreateEmptyVaultHandler({
    onVaultReady: options.onVaultReady,
    registerVault: options.registerVault,
    setCreatingAction,
    setError,
    setState,
  })

  const handleOpenFolder = useOpenFolderHandler({
    onVaultReady: options.onVaultReady,
    registerVault: options.registerVault,
    setError,
    setState,
  })

  const handleDismiss = useCallback(() => {
    markDismissed()
    setState({ status: 'ready', vaultPath: initialVaultPath })
  }, [initialVaultPath])

  const resolvedState = initialVaultResolved ? state : { status: 'loading' as const }

  return {
    state: resolvedState,
    creating: creatingAction !== null,
    creatingAction,
    error,
    canRetryTemplate: !!error && !!lastTemplatePath && creatingAction === null,
    handleCreateVault,
    retryCreateVault,
    handleCreateEmptyVault,
    handleOpenFolder,
    handleDismiss,
  }
}
