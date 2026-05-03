import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import { formatFolderPickerActionError, pickFolder } from '../utils/vault-dialog'
import { loadVaultList, saveVaultList } from '../utils/vaultListStore'
import type { VaultOption } from '../components/StatusBar'
import { trackEvent } from '../lib/telemetry'

export type { PersistedVaultList } from '../utils/vaultListStore'

export const GETTING_STARTED_LABEL = 'Getting Started'

declare const __DEMO_VAULT_PATH__: string | undefined

/** Build-time demo vault path (dev only). In production Tauri builds this is
 *  undefined and the real path is resolved at runtime via get_default_vault_path. */
const STATIC_DEFAULT_PATH = typeof __DEMO_VAULT_PATH__ !== 'undefined' ? __DEMO_VAULT_PATH__ : ''

export const DEFAULT_VAULTS: VaultOption[] = [
  { label: GETTING_STARTED_LABEL, path: STATIC_DEFAULT_PATH },
]

interface UseVaultSwitcherOptions {
  onSwitch: () => void
  onToast: (msg: string) => void
}

interface PersistedVaultState {
  defaultAvailable: boolean
  defaultPath: string
  extraVaults: VaultOption[]
  hiddenDefaults: string[]
  lastPersistedSnapshotRef: MutableRefObject<string | null>
  loaded: boolean
  selectedVaultPath: string | null
  setDefaultAvailable: Dispatch<SetStateAction<boolean>>
  setExtraVaults: Dispatch<SetStateAction<VaultOption[]>>
  setHiddenDefaults: Dispatch<SetStateAction<string[]>>
  setSelectedVaultPath: Dispatch<SetStateAction<string | null>>
  setVaultPath: Dispatch<SetStateAction<string>>
  vaultPath: string
}

interface VaultCollections {
  allVaults: VaultOption[]
  defaultVaults: VaultOption[]
  isGettingStartedHidden: boolean
}

interface PersistedVaultStore {
  defaultAvailable: boolean
  defaultPath: string
  extraVaults: VaultOption[]
  hiddenDefaults: string[]
  lastPersistedSnapshotRef: MutableRefObject<string | null>
  loaded: boolean
  selectedVaultPath: string | null
  setDefaultAvailable: Dispatch<SetStateAction<boolean>>
  setDefaultPath: Dispatch<SetStateAction<string>>
  setExtraVaults: Dispatch<SetStateAction<VaultOption[]>>
  setHiddenDefaults: Dispatch<SetStateAction<string[]>>
  setLoaded: Dispatch<SetStateAction<boolean>>
  setSelectedVaultPath: Dispatch<SetStateAction<string | null>>
  setVaultPath: Dispatch<SetStateAction<string>>
  vaultPath: string
}

interface VaultActionOptions extends PersistedVaultState, VaultCollections {
  onSwitchRef: MutableRefObject<() => void>
  onToastRef: MutableRefObject<(msg: string) => void>
}

interface RegisteredVaultSelection {
  nextDefaultAvailable: boolean
  nextExtraVaults: VaultOption[]
  nextHiddenDefaults: string[]
  nextSelectedVaultPath: string
}

interface RegisterVaultSelectionOptions {
  verifyAvailability?: boolean
}

interface RestoreGettingStartedOptions {
  defaultPath: string
  onToastRef: MutableRefObject<(msg: string) => void>
  setDefaultAvailable: Dispatch<SetStateAction<boolean>>
  setHiddenDefaults: Dispatch<SetStateAction<string[]>>
  switchVault: (path: string) => void
}

interface RemainingVaultOptions {
  defaultVaults: VaultOption[]
  extraVaults: VaultOption[]
  hiddenDefaults: string[]
  isDefault: boolean
  removedPath: string
}

interface RemoveVaultStateOptions extends RemainingVaultOptions {
  selectedVaultPath: string | null
  onSwitchRef: MutableRefObject<() => void>
  setExtraVaults: Dispatch<SetStateAction<VaultOption[]>>
  setHiddenDefaults: Dispatch<SetStateAction<string[]>>
  setSelectedVaultPath: Dispatch<SetStateAction<string | null>>
  setVaultPath: Dispatch<SetStateAction<string>>
  vaultPath: string
}

interface RemoveVaultActionOptions {
  defaultVaults: VaultOption[]
  extraVaults: VaultOption[]
  hiddenDefaults: string[]
  onSwitchRef: MutableRefObject<() => void>
  onToastRef: MutableRefObject<(msg: string) => void>
  setExtraVaults: Dispatch<SetStateAction<VaultOption[]>>
  setHiddenDefaults: Dispatch<SetStateAction<string[]>>
  setSelectedVaultPath: Dispatch<SetStateAction<string | null>>
  setVaultPath: Dispatch<SetStateAction<string>>
  selectedVaultPath: string | null
  vaultPath: string
}

interface VaultPathInput {
  path: string
}

function labelFromPath({ path }: VaultPathInput): string {
  return path.split('/').pop() || 'Local Vault'
}

function tauriCall<T>(command: string, args: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args)
}

function serializePersistedVaultSnapshot(
  vaults: VaultOption[],
  activeVault: string | null,
  hiddenDefaults: string[],
): string {
  return JSON.stringify({
    activeVault,
    hiddenDefaults,
    vaults: vaults.map(({ label, path }) => ({ label, path })),
  })
}

async function resolveDefaultPath(): Promise<string> {
  if (STATIC_DEFAULT_PATH) {
    return STATIC_DEFAULT_PATH
  }

  try {
    return await tauriCall<string>('get_default_vault_path', {})
  } catch {
    return ''
  }
}

function syncDefaultVaultExport(path: string) {
  DEFAULT_VAULTS[0] = { label: GETTING_STARTED_LABEL, path }
}

function selectedBridgeVaultPath(selectedVaultPath: string | null): string | null {
  const path = selectedVaultPath?.trim()
  return path ? path : null
}

async function syncMcpBridgeVault(selectedVaultPath: string | null): Promise<void> {
  await tauriCall<string>('sync_mcp_bridge_vault', {
    vaultPath: selectedBridgeVaultPath(selectedVaultPath),
  })
}

function isCanonicalGettingStartedPath(path: string, resolvedDefaultPath: string): boolean {
  return path === resolvedDefaultPath
}

function isUnavailableGettingStartedVault(vault: VaultOption): boolean {
  return vault.label === GETTING_STARTED_LABEL && vault.available === false
}

function shouldDropPersistedGettingStartedVault(vault: VaultOption, resolvedDefaultPath: string): boolean {
  return isCanonicalGettingStartedPath(vault.path, resolvedDefaultPath) || isUnavailableGettingStartedVault(vault)
}

async function checkVaultAvailability(path: string): Promise<boolean> {
  if (!path) {
    return false
  }

  try {
    return await tauriCall<boolean>('check_vault_exists', { path })
  } catch {
    return false
  }
}

async function loadInitialVaultState() {
  const [vaultListResult, defaultPathResult] = await Promise.allSettled([
    loadVaultList(),
    resolveDefaultPath(),
  ])
  const { vaults, activeVault, hiddenDefaults } = vaultListResult.status === 'fulfilled'
    ? vaultListResult.value
    : { vaults: [], activeVault: null, hiddenDefaults: [] }
  const resolvedDefaultPath = defaultPathResult.status === 'fulfilled'
    ? defaultPathResult.value
    : ''
  const defaultAvailable = await checkVaultAvailability(resolvedDefaultPath)

  if (vaultListResult.status === 'rejected') {
    console.warn('Failed to load vault list:', vaultListResult.reason)
  }

  const sanitizedState = sanitizeCanonicalGettingStartedState({
    activeVault,
    defaultAvailable,
    hiddenDefaults,
    resolvedDefaultPath,
    vaults,
  })
  const persistedSnapshot = serializePersistedVaultSnapshot(vaults, activeVault, hiddenDefaults)

  return {
    ...sanitizedState,
    persistedSnapshot,
  }
}

function sanitizeCanonicalGettingStartedState({
  activeVault,
  defaultAvailable,
  hiddenDefaults,
  resolvedDefaultPath,
  vaults,
}: {
  activeVault: string | null
  defaultAvailable: boolean
  hiddenDefaults: string[]
  resolvedDefaultPath: string
  vaults: VaultOption[]
}) {
  if (!resolvedDefaultPath) {
    return { activeVault, defaultAvailable, hiddenDefaults, resolvedDefaultPath, vaults }
  }

  const filteredVaults = vaults.filter(
    (vault) => !shouldDropPersistedGettingStartedVault(vault, resolvedDefaultPath),
  )
  const removedStarterPaths = new Set(
    vaults
      .filter((vault) => shouldDropPersistedGettingStartedVault(vault, resolvedDefaultPath))
      .map((vault) => vault.path),
  )
  const sanitizedActiveVault = resolveSanitizedGettingStartedSelection({
    activeVault,
    defaultAvailable,
    filteredVaults,
    removedStarterPaths,
    resolvedDefaultPath,
  })

  return {
    activeVault: sanitizedActiveVault,
    defaultAvailable,
    hiddenDefaults,
    resolvedDefaultPath,
    vaults: filteredVaults,
  }
}

function resolveSanitizedGettingStartedSelection({
  activeVault,
  defaultAvailable,
  filteredVaults,
  removedStarterPaths,
  resolvedDefaultPath,
}: {
  activeVault: string | null
  defaultAvailable: boolean
  filteredVaults: VaultOption[]
  removedStarterPaths: Set<string>
  resolvedDefaultPath: string
}): string | null {
  if (!activeVault || !removedStarterPaths.has(activeVault)) {
    return activeVault
  }

  if (isCanonicalGettingStartedPath(activeVault, resolvedDefaultPath) && defaultAvailable) {
    return activeVault
  }

  return filteredVaults[0]?.path ?? null
}

function buildDefaultVaults({
  defaultAvailable,
  defaultPath,
}: {
  defaultAvailable: boolean
  defaultPath: string
}): VaultOption[] {
  if (!defaultAvailable || !defaultPath) {
    return []
  }

  return [{ label: GETTING_STARTED_LABEL, path: defaultPath }]
}

function buildVisibleDefaultVaults({
  defaultVaults,
  hiddenDefaults,
}: {
  defaultVaults: VaultOption[]
  hiddenDefaults: string[]
}): VaultOption[] {
  return defaultVaults.filter(vault => !hiddenDefaults.includes(vault.path))
}

function buildAllVaults({
  visibleDefaults,
  extraVaults,
}: {
  visibleDefaults: VaultOption[]
  extraVaults: VaultOption[]
}): VaultOption[] {
  return [...visibleDefaults, ...extraVaults]
}

function applyResolvedDefaultPath({
  defaultAvailable,
  resolvedDefaultPath,
  setDefaultAvailable,
  setDefaultPath,
}: {
  defaultAvailable: boolean
  resolvedDefaultPath: string
  setDefaultAvailable: Dispatch<SetStateAction<boolean>>
  setDefaultPath: Dispatch<SetStateAction<string>>
}) {
  setDefaultAvailable(defaultAvailable)

  if (!resolvedDefaultPath) {
    return
  }

  setDefaultPath(resolvedDefaultPath)
  syncDefaultVaultExport(resolvedDefaultPath)
}

function normalizeInitialSelectedVaultPath(
  activeVault: string | null,
  resolvedDefaultPath: string,
  vaults: VaultOption[],
): string | null {
  if (!activeVault) {
    return null
  }

  const isRememberedDefaultOnlySelection = activeVault === resolvedDefaultPath && vaults.length === 0
  return isRememberedDefaultOnlySelection ? null : activeVault
}

function applyInitialVaultTarget({
  activeVault,
  resolvedDefaultPath,
  setSelectedVaultPath,
  setVaultPath,
  onSwitchRef,
}: {
  activeVault: string | null
  resolvedDefaultPath: string
  setSelectedVaultPath: Dispatch<SetStateAction<string | null>>
  setVaultPath: Dispatch<SetStateAction<string>>
  onSwitchRef: MutableRefObject<() => void>
}) {
  if (activeVault) {
    setVaultPath(activeVault)
    setSelectedVaultPath(activeVault)
    onSwitchRef.current()
    return
  }

  if (resolvedDefaultPath) {
    setVaultPath(resolvedDefaultPath)
  }
}

function useVaultCollections(
  defaultAvailable: boolean,
  defaultPath: string,
  hiddenDefaults: string[],
  extraVaults: VaultOption[],
): VaultCollections {
  const defaultVaults = useMemo(
    () => buildDefaultVaults({ defaultAvailable, defaultPath }),
    [defaultAvailable, defaultPath],
  )
  const visibleDefaults = useMemo(
    () => buildVisibleDefaultVaults({ defaultVaults, hiddenDefaults }),
    [defaultVaults, hiddenDefaults],
  )
  const allVaults = useMemo(
    () => buildAllVaults({ visibleDefaults, extraVaults }),
    [extraVaults, visibleDefaults],
  )
  const isGettingStartedHidden = useMemo(
    () => hiddenDefaults.includes(defaultPath),
    [defaultPath, hiddenDefaults],
  )

  return { allVaults, defaultVaults, isGettingStartedHidden }
}

function useLoadPersistedVaultState(
  store: PersistedVaultStore,
  onSwitchRef: MutableRefObject<() => void>,
) {
  const {
    lastPersistedSnapshotRef,
    setDefaultAvailable,
    setDefaultPath,
    setExtraVaults,
    setHiddenDefaults,
    setLoaded,
    setSelectedVaultPath,
    setVaultPath,
  } = store

  useEffect(() => {
    let cancelled = false

    loadInitialVaultState()
      .then(({ activeVault, defaultAvailable, hiddenDefaults: hidden, persistedSnapshot, resolvedDefaultPath, vaults }) => {
        if (cancelled) return

        lastPersistedSnapshotRef.current = persistedSnapshot
        setExtraVaults(vaults)
        setHiddenDefaults(hidden)
        applyResolvedDefaultPath({
          defaultAvailable,
          resolvedDefaultPath,
          setDefaultAvailable,
          setDefaultPath,
        })
        applyInitialVaultTarget({
          activeVault: normalizeInitialSelectedVaultPath(activeVault, resolvedDefaultPath, vaults),
          resolvedDefaultPath,
          setSelectedVaultPath,
          setVaultPath,
          onSwitchRef,
        })
      })
      .finally(() => {
        if (!cancelled) {
          setLoaded(true)
        }
      })

    return () => { cancelled = true }
  }, [lastPersistedSnapshotRef, onSwitchRef, setDefaultAvailable, setDefaultPath, setExtraVaults, setHiddenDefaults, setLoaded, setSelectedVaultPath, setVaultPath])
}

function usePersistedVaultStorage(store: PersistedVaultStore) {
  const { extraVaults, hiddenDefaults, lastPersistedSnapshotRef, loaded, selectedVaultPath } = store

  useEffect(() => {
    if (!loaded) return

    const snapshot = serializePersistedVaultSnapshot(extraVaults, selectedVaultPath, hiddenDefaults)

    if (lastPersistedSnapshotRef.current === snapshot) {
      return
    }

    saveVaultList(extraVaults, selectedVaultPath, hiddenDefaults)
      .then(() => {
        lastPersistedSnapshotRef.current = snapshot
      })
      .catch(err => {
        console.warn('Failed to persist vault list:', err)
      })
  }, [extraVaults, hiddenDefaults, lastPersistedSnapshotRef, loaded, selectedVaultPath])
}

function usePersistedVaultState(onSwitchRef: MutableRefObject<() => void>): PersistedVaultState {
  const [vaultPath, setVaultPath] = useState(STATIC_DEFAULT_PATH)
  const [selectedVaultPath, setSelectedVaultPath] = useState<string | null>(null)
  const [extraVaults, setExtraVaults] = useState<VaultOption[]>([])
  const [hiddenDefaults, setHiddenDefaults] = useState<string[]>([])
  const [defaultAvailable, setDefaultAvailable] = useState(false)
  const lastPersistedSnapshotRef = useRef<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [defaultPath, setDefaultPath] = useState(STATIC_DEFAULT_PATH)

  const store: PersistedVaultStore = {
    defaultAvailable,
    defaultPath,
    extraVaults,
    hiddenDefaults,
    lastPersistedSnapshotRef,
    loaded,
    selectedVaultPath,
    setDefaultAvailable,
    setDefaultPath,
    setExtraVaults,
    setHiddenDefaults,
    setLoaded,
    setSelectedVaultPath,
    setVaultPath,
    vaultPath,
  }

  useLoadPersistedVaultState(store, onSwitchRef)
  usePersistedVaultStorage(store)

  return {
    defaultAvailable,
    defaultPath,
    extraVaults,
    hiddenDefaults,
    lastPersistedSnapshotRef,
    loaded,
    selectedVaultPath,
    setDefaultAvailable,
    setExtraVaults,
    setHiddenDefaults,
    setSelectedVaultPath,
    setVaultPath,
    vaultPath,
  }
}

function useMcpBridgeVaultSync(loaded: boolean, selectedVaultPath: string | null) {
  useEffect(() => {
    if (!loaded) return

    syncMcpBridgeVault(selectedVaultPath).catch(err => {
      console.warn('Failed to sync MCP bridge vault:', err)
    })
  }, [loaded, selectedVaultPath])
}

function formatGettingStartedRestoreError(err: unknown): string {
  const message =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : `${err}`

  const networkErrors = [
    'unable to access',
    'Could not resolve host',
    'network',
    'timed out',
  ]

  if (networkErrors.some(fragment => message.includes(fragment))) {
    return 'Getting Started requires internet. Clone it later.'
  }

  return `Could not prepare Getting Started vault: ${message}`
}

function formatCreateEmptyVaultError(err: unknown): string {
  const message =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : `${err}`

  if (message.includes('Choose an empty folder')) {
    return message
  }

  return `Could not create empty vault: ${message}`
}

async function ensureGettingStartedVaultReady(path: string): Promise<void> {
  const exists = await tauriCall<boolean>('check_vault_exists', { path })
  if (!exists) {
    await tauriCall<string>('create_getting_started_vault', { targetPath: path })
  }
}

function addVaultToList({
  setExtraVaults,
  path,
  label,
}: {
  setExtraVaults: Dispatch<SetStateAction<VaultOption[]>>
  path: string
  label: string
}) {
  setExtraVaults(previousVaults => {
    const exists = previousVaults.some(vault => vault.path === path)
    return exists ? previousVaults : [...previousVaults, { label, path, available: true }]
  })
}

function upsertAvailableVaultOption(
  extraVaults: VaultOption[],
  path: string,
  label: string,
): VaultOption[] {
  const existingVault = extraVaults.find((vault) => vault.path === path)
  if (!existingVault) {
    return [...extraVaults, { label, path, available: true }]
  }

  return extraVaults.map((vault) => (
    vault.path === path
      ? { ...vault, label: vault.label || label, available: true }
      : vault
  ))
}

function buildRegisteredVaultSelection({
  defaultAvailable,
  defaultPath,
  extraVaults,
  hiddenDefaults,
  label,
  path,
}: {
  defaultAvailable: boolean
  defaultPath: string
  extraVaults: VaultOption[]
  hiddenDefaults: string[]
  label: string
  path: string
}): RegisteredVaultSelection {
  const isCanonicalDefaultVault = path === defaultPath && defaultPath.length > 0

  return {
    nextDefaultAvailable: isCanonicalDefaultVault ? true : defaultAvailable,
    nextExtraVaults: isCanonicalDefaultVault
      ? extraVaults.filter((vault) => vault.path !== path)
      : upsertAvailableVaultOption(extraVaults, path, label),
    nextHiddenDefaults: isCanonicalDefaultVault
      ? hiddenDefaults.filter((hiddenPath) => hiddenPath !== path)
      : hiddenDefaults,
    nextSelectedVaultPath: path,
  }
}

async function persistRegisteredVaultSelection({
  hiddenDefaults,
  lastPersistedSnapshotRef,
  selectedVaultPath,
  vaults,
}: {
  hiddenDefaults: string[]
  lastPersistedSnapshotRef: MutableRefObject<string | null>
  selectedVaultPath: string
  vaults: VaultOption[]
}): Promise<void> {
  const nextSnapshot = serializePersistedVaultSnapshot(
    vaults,
    selectedVaultPath,
    hiddenDefaults,
  )
  await saveVaultList(vaults, selectedVaultPath, hiddenDefaults)
  lastPersistedSnapshotRef.current = nextSnapshot
}

function applyRegisteredVaultSelection({
  nextDefaultAvailable,
  nextExtraVaults,
  nextHiddenDefaults,
  nextSelectedVaultPath,
  onSwitchRef,
  setDefaultAvailable,
  setExtraVaults,
  setHiddenDefaults,
  setSelectedVaultPath,
  setVaultPath,
}: RegisteredVaultSelection & {
  onSwitchRef: MutableRefObject<() => void>
  setDefaultAvailable: Dispatch<SetStateAction<boolean>>
  setExtraVaults: Dispatch<SetStateAction<VaultOption[]>>
  setHiddenDefaults: Dispatch<SetStateAction<string[]>>
  setSelectedVaultPath: Dispatch<SetStateAction<string | null>>
  setVaultPath: Dispatch<SetStateAction<string>>
}) {
  setDefaultAvailable(nextDefaultAvailable)
  setExtraVaults(nextExtraVaults)
  setHiddenDefaults(nextHiddenDefaults)
  switchVaultPath({
    setSelectedVaultPath,
    setVaultPath,
    onSwitchRef,
    path: nextSelectedVaultPath,
  })
}

function switchVaultPath({
  setSelectedVaultPath,
  setVaultPath,
  onSwitchRef,
  path,
}: {
  setSelectedVaultPath: Dispatch<SetStateAction<string | null>>
  setVaultPath: Dispatch<SetStateAction<string>>
  onSwitchRef: MutableRefObject<() => void>
  path: string
}) {
  trackEvent('vault_switched')
  setSelectedVaultPath(path)
  setVaultPath(path)
  onSwitchRef.current()
}

async function ensureVaultCanBeRegistered(path: string): Promise<void> {
  const exists = await checkVaultAvailability(path)
  if (!exists) {
    throw new Error('Selected folder is not available')
  }
}

function listRemainingVaults({
  defaultVaults,
  extraVaults,
  hiddenDefaults,
  isDefault,
  removedPath,
}: RemainingVaultOptions) {
  const visibleDefaults = defaultVaults.filter(vault => (
    vault.path !== removedPath
    && (!isDefault || !hiddenDefaults.includes(vault.path))
  ))

  return [...visibleDefaults, ...extraVaults.filter(vault => vault.path !== removedPath)]
}

function removeVaultFromState({
  defaultVaults,
  extraVaults,
  hiddenDefaults,
  isDefault,
  onSwitchRef,
  removedPath,
  setExtraVaults,
  setHiddenDefaults,
  setSelectedVaultPath,
  setVaultPath,
  selectedVaultPath,
  vaultPath,
}: RemoveVaultStateOptions) {
  if (isDefault) {
    setHiddenDefaults(previousHidden => previousHidden.includes(removedPath) ? previousHidden : [...previousHidden, removedPath])
  } else {
    setExtraVaults(previousVaults => previousVaults.filter(vault => vault.path !== removedPath))
  }

  if (vaultPath !== removedPath) {
    if (selectedVaultPath === removedPath) {
      setSelectedVaultPath(null)
    }
    return
  }

  const remainingVaults = listRemainingVaults({
    defaultVaults,
    extraVaults,
    hiddenDefaults,
    isDefault,
    removedPath,
  })
  if (remainingVaults.length === 0) {
    setSelectedVaultPath(null)
    return
  }

  const nextPath = remainingVaults[0].path
  setSelectedVaultPath(nextPath)
  setVaultPath(nextPath)
  onSwitchRef.current()
}

function getRemovedVaultLabel({
  path,
  defaultVaults,
  extraVaults,
}: {
  path: string
  defaultVaults: VaultOption[]
  extraVaults: VaultOption[]
}): string {
  const removedVault = [...defaultVaults, ...extraVaults].find(vault => vault.path === path)
  return removedVault?.label ?? labelFromPath({ path })
}

function useSwitchVaultAction(
  onSwitchRef: MutableRefObject<() => void>,
  setSelectedVaultPath: Dispatch<SetStateAction<string | null>>,
  setVaultPath: Dispatch<SetStateAction<string>>,
) {
  return useCallback((path: string) => {
    switchVaultPath({ setSelectedVaultPath, setVaultPath, onSwitchRef, path })
  }, [onSwitchRef, setSelectedVaultPath, setVaultPath])
}

function useVaultClonedAction(
  addAndSwitch: (path: string, label: string) => void,
  onToastRef: MutableRefObject<(msg: string) => void>,
) {
  return useCallback((path: string, label: string) => {
    addAndSwitch(path, label)
    onToastRef.current(`Vault "${label}" cloned and opened`)
  }, [addAndSwitch, onToastRef])
}

function useRegisterVaultSelectionAction({
  defaultAvailable,
  defaultPath,
  extraVaults,
  hiddenDefaults,
  lastPersistedSnapshotRef,
  onSwitchRef,
  setDefaultAvailable,
  setExtraVaults,
  setHiddenDefaults,
  setSelectedVaultPath,
  setVaultPath,
}: {
  defaultAvailable: boolean
  defaultPath: string
  extraVaults: VaultOption[]
  hiddenDefaults: string[]
  lastPersistedSnapshotRef: MutableRefObject<string | null>
  onSwitchRef: MutableRefObject<() => void>
  setDefaultAvailable: Dispatch<SetStateAction<boolean>>
  setExtraVaults: Dispatch<SetStateAction<VaultOption[]>>
  setHiddenDefaults: Dispatch<SetStateAction<string[]>>
  setSelectedVaultPath: Dispatch<SetStateAction<string | null>>
  setVaultPath: Dispatch<SetStateAction<string>>
}) {
  return useCallback(async (path: string, label: string, options: RegisterVaultSelectionOptions = {}) => {
    if (options.verifyAvailability !== false) {
      await ensureVaultCanBeRegistered(path)
    }

    const nextSelection = buildRegisteredVaultSelection({
      defaultAvailable,
      defaultPath,
      extraVaults,
      hiddenDefaults,
      label,
      path,
    })
    await persistRegisteredVaultSelection({
      hiddenDefaults: nextSelection.nextHiddenDefaults,
      lastPersistedSnapshotRef,
      selectedVaultPath: nextSelection.nextSelectedVaultPath,
      vaults: nextSelection.nextExtraVaults,
    })
    applyRegisteredVaultSelection({
      ...nextSelection,
      onSwitchRef,
      setDefaultAvailable,
      setExtraVaults,
      setHiddenDefaults,
      setSelectedVaultPath,
      setVaultPath,
    })
  }, [
    defaultAvailable,
    defaultPath,
    extraVaults,
    hiddenDefaults,
    lastPersistedSnapshotRef,
    onSwitchRef,
    setDefaultAvailable,
    setExtraVaults,
    setHiddenDefaults,
    setSelectedVaultPath,
    setVaultPath,
  ])
}

function useSyncVaultSelectionAction({
  defaultAvailable,
  defaultPath,
  extraVaults,
  hiddenDefaults,
  onSwitchRef,
  setDefaultAvailable,
  setExtraVaults,
  setHiddenDefaults,
  setSelectedVaultPath,
  setVaultPath,
}: {
  defaultAvailable: boolean
  defaultPath: string
  extraVaults: VaultOption[]
  hiddenDefaults: string[]
  onSwitchRef: MutableRefObject<() => void>
  setDefaultAvailable: Dispatch<SetStateAction<boolean>>
  setExtraVaults: Dispatch<SetStateAction<VaultOption[]>>
  setHiddenDefaults: Dispatch<SetStateAction<string[]>>
  setSelectedVaultPath: Dispatch<SetStateAction<string | null>>
  setVaultPath: Dispatch<SetStateAction<string>>
}) {
  return useCallback((path: string, label: string) => {
    const nextSelection = buildRegisteredVaultSelection({
      defaultAvailable,
      defaultPath,
      extraVaults,
      hiddenDefaults,
      label,
      path,
    })
    applyRegisteredVaultSelection({
      ...nextSelection,
      onSwitchRef,
      setDefaultAvailable,
      setExtraVaults,
      setHiddenDefaults,
      setSelectedVaultPath,
      setVaultPath,
    })
  }, [
    defaultAvailable,
    defaultPath,
    extraVaults,
    hiddenDefaults,
    onSwitchRef,
    setDefaultAvailable,
    setExtraVaults,
    setHiddenDefaults,
    setSelectedVaultPath,
    setVaultPath,
  ])
}

function useOpenLocalFolderAction(
  addAndSwitch: (path: string, label: string) => void,
  onToastRef: MutableRefObject<(msg: string) => void>,
) {
  return useCallback(async () => {
    let path: string | null
    try {
      path = await pickFolder('Open vault folder')
    } catch (err) {
      onToastRef.current(formatFolderPickerActionError('Could not open vault folder', err))
      return
    }

    if (!path) return

    const label = labelFromPath({ path })
    addAndSwitch(path, label)
    onToastRef.current(`Vault "${label}" opened`)
  }, [addAndSwitch, onToastRef])
}

function useCreateEmptyVaultAction(
  addAndSwitch: (path: string, label: string) => void,
  onToastRef: MutableRefObject<(msg: string) => void>,
) {
  return useCallback(async () => {
    let targetPath: string | null
    try {
      targetPath = await pickFolder('Choose where to create your vault')
    } catch (err) {
      onToastRef.current(formatFolderPickerActionError('Could not choose where to create your vault', err))
      return
    }

    try {
      if (!targetPath) return
      const vaultPath = await tauriCall<string>('create_empty_vault', { targetPath })
      const label = labelFromPath({ path: vaultPath })
      addAndSwitch(vaultPath, label)
      onToastRef.current(`Vault "${label}" created and opened`)
    } catch (err) {
      onToastRef.current(formatCreateEmptyVaultError(err))
    }
  }, [addAndSwitch, onToastRef])
}

function useRemoveVaultAction({
  defaultVaults,
  extraVaults,
  hiddenDefaults,
  onSwitchRef,
  onToastRef,
  setExtraVaults,
  setHiddenDefaults,
  setSelectedVaultPath,
  setVaultPath,
  selectedVaultPath,
  vaultPath,
}: RemoveVaultActionOptions) {
  return useCallback((path: string) => {
    const isDefault = defaultVaults.some(vault => vault.path === path)

    removeVaultFromState({
      defaultVaults,
      extraVaults,
      hiddenDefaults,
      isDefault,
      onSwitchRef,
      removedPath: path,
      setExtraVaults,
      setHiddenDefaults,
      setSelectedVaultPath,
      setVaultPath,
      selectedVaultPath,
      vaultPath,
    })
    onToastRef.current(`Vault "${getRemovedVaultLabel({ path, defaultVaults, extraVaults })}" removed from list`)
  }, [
    defaultVaults,
    extraVaults,
    hiddenDefaults,
    onSwitchRef,
    onToastRef,
    setExtraVaults,
    setHiddenDefaults,
    setSelectedVaultPath,
    setVaultPath,
    selectedVaultPath,
    vaultPath,
  ])
}

function useRestoreGettingStartedAction(options: RestoreGettingStartedOptions) {
  const { defaultPath, onToastRef, setDefaultAvailable, setHiddenDefaults, switchVault } = options

  return useCallback(() => {
    return restoreGettingStartedVault({
      defaultPath,
      onToastRef,
      setDefaultAvailable,
      setHiddenDefaults,
      switchVault,
    })
  }, [defaultPath, onToastRef, setDefaultAvailable, setHiddenDefaults, switchVault])
}

function useVaultActions({
  defaultAvailable,
  defaultPath,
  defaultVaults,
  extraVaults,
  hiddenDefaults,
  lastPersistedSnapshotRef,
  onSwitchRef,
  onToastRef,
  setDefaultAvailable,
  setExtraVaults,
  setHiddenDefaults,
  selectedVaultPath,
  setSelectedVaultPath,
  setVaultPath,
  vaultPath,
}: VaultActionOptions) {
  const addVault = useCallback((path: string, label: string) => {
    addVaultToList({ setExtraVaults, path, label })
  }, [setExtraVaults])

  const switchVault = useSwitchVaultAction(onSwitchRef, setSelectedVaultPath, setVaultPath)
  const registerVaultSelection = useRegisterVaultSelectionAction({
    defaultAvailable,
    defaultPath,
    extraVaults,
    hiddenDefaults,
    lastPersistedSnapshotRef,
    onSwitchRef,
    setDefaultAvailable,
    setExtraVaults,
    setHiddenDefaults,
    setSelectedVaultPath,
    setVaultPath,
  })
  const syncVaultSelection = useSyncVaultSelectionAction({
    defaultAvailable,
    defaultPath,
    extraVaults,
    hiddenDefaults,
    onSwitchRef,
    setDefaultAvailable,
    setExtraVaults,
    setHiddenDefaults,
    setSelectedVaultPath,
    setVaultPath,
  })
  const addAndSwitch = useCallback((path: string, label: string) => {
    addVault(path, label)
    switchVault(path)
  }, [addVault, switchVault])

  return {
    handleCreateEmptyVault: useCreateEmptyVaultAction(addAndSwitch, onToastRef),
    handleOpenLocalFolder: useOpenLocalFolderAction(addAndSwitch, onToastRef),
    handleVaultCloned: useVaultClonedAction(addAndSwitch, onToastRef),
    registerVaultSelection,
    removeVault: useRemoveVaultAction({
      defaultVaults,
      extraVaults,
      hiddenDefaults,
      onSwitchRef,
      onToastRef,
      setExtraVaults,
      setHiddenDefaults,
      setSelectedVaultPath,
      setVaultPath,
      selectedVaultPath,
      vaultPath,
    }),
    restoreGettingStarted: useRestoreGettingStartedAction({
      defaultPath,
      onToastRef,
      setDefaultAvailable,
      setHiddenDefaults,
      switchVault,
    }),
    syncVaultSelection,
    switchVault,
  }
}

async function restoreGettingStartedVault({
  defaultPath,
  onToastRef,
  setDefaultAvailable,
  setHiddenDefaults,
  switchVault,
}: RestoreGettingStartedOptions) {
  if (!defaultPath) {
    onToastRef.current('Could not resolve the Getting Started vault path')
    return
  }

  try {
    await ensureGettingStartedVaultReady(defaultPath)
    setDefaultAvailable(true)
    setHiddenDefaults(previousHidden => previousHidden.filter(path => path !== defaultPath))
    switchVault(defaultPath)
    onToastRef.current('Getting Started vault ready')
  } catch (err) {
    onToastRef.current(formatGettingStartedRestoreError(err))
  }
}

/** Manages vault path, extra vaults, switching, cloning, and local folder opening.
 *  Vault list and active vault are persisted via Tauri backend to survive app updates. */
export function useVaultSwitcher({ onSwitch, onToast }: UseVaultSwitcherOptions) {
  const onSwitchRef = useRef(onSwitch)
  const onToastRef = useRef(onToast)
  useEffect(() => { onSwitchRef.current = onSwitch; onToastRef.current = onToast })

  const persistedState = usePersistedVaultState(onSwitchRef)
  const {
    defaultAvailable,
    defaultPath,
    extraVaults,
    hiddenDefaults,
    loaded,
    selectedVaultPath,
    vaultPath,
  } = persistedState
  useMcpBridgeVaultSync(loaded, selectedVaultPath)

  const { allVaults, defaultVaults, isGettingStartedHidden } = useVaultCollections(
    defaultAvailable,
    defaultPath,
    hiddenDefaults,
    extraVaults,
  )
  const {
    handleCreateEmptyVault,
    handleOpenLocalFolder,
    handleVaultCloned,
    registerVaultSelection,
    removeVault,
    restoreGettingStarted,
    syncVaultSelection,
    switchVault,
  } = useVaultActions({
    ...persistedState,
    allVaults,
    defaultVaults,
    isGettingStartedHidden,
    onSwitchRef,
    onToastRef,
  })

  return {
    allVaults,
    defaultPath,
    handleCreateEmptyVault,
    handleOpenLocalFolder,
    handleVaultCloned,
    isGettingStartedHidden,
    loaded,
    registerVaultSelection,
    removeVault,
    restoreGettingStarted,
    selectedVaultPath,
    syncVaultSelection,
    switchVault,
    vaultPath,
  }
}
