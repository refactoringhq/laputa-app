import { useState, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import { normalizeValidatedVaultProviderSelection } from '../lib/vaultProviders'
import type { VaultProviderType, ValidatedVaultProviderSelection } from '../lib/vaultProviders'

export interface VaultProviderState {
  isSelectingProvider: boolean
  candidatePath: string | null
  explicitProviderType: VaultProviderType | null
  validationResult: ValidatedVaultProviderSelection | null
}

export function useVaultProviderState() {
  const [state, setState] = useState<VaultProviderState>({
    isSelectingProvider: false,
    candidatePath: null,
    explicitProviderType: null,
    validationResult: null,
  })

  // We keep a ref to the pending completion callback so we can resume the flow
  const pendingCallbackRef = useRef<((result: ValidatedVaultProviderSelection) => void) | null>(null)

  const tauriCall = useCallback(<T>(command: string, args: Record<string, unknown>): Promise<T> => {
    return isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args)
  }, [])

  const startProviderSelection = useCallback(async (
    path: string, 
    explicitProviderType: VaultProviderType | null,
    onComplete: (result: ValidatedVaultProviderSelection) => void
  ) => {
    try {
      const rawResult = await tauriCall<Omit<ValidatedVaultProviderSelection, 'providerType'> & { providerType?: string | null }>('validate_vault_provider_selection', {
        path,
        explicit_provider_type: explicitProviderType ?? null,
      })

      const validationResult = normalizeValidatedVaultProviderSelection(rawResult)

      const requiresConfirmation = 
        (!explicitProviderType && validationResult.providerType === 'icloud-drive') ||
        validationResult.validationResult === 'warning' ||
        validationResult.validationResult === 'invalid'

      if (requiresConfirmation) {
        pendingCallbackRef.current = onComplete
        setState({
          isSelectingProvider: true,
          candidatePath: path,
          explicitProviderType: explicitProviderType ?? null,
          validationResult,
        })
        return { needsConfirmation: true, result: null }
      }

      onComplete(validationResult)
      return { needsConfirmation: false, result: validationResult }
    } catch (err) {
      console.error('Failed to validate vault provider:', err)
      return { needsConfirmation: false, result: null }
    }
  }, [tauriCall])

  const confirmProvider = useCallback(async (providerType: VaultProviderType) => {
    if (!state.candidatePath) return null

    try {
      const rawResult = await tauriCall<Omit<ValidatedVaultProviderSelection, 'providerType'> & { providerType?: string | null }>('validate_vault_provider_selection', {
        path: state.candidatePath,
        explicit_provider_type: providerType,
      })

      const result = normalizeValidatedVaultProviderSelection(rawResult)

      if (result.validationResult === 'invalid' || result.validationResult === 'warning') {
        setState((prev) => ({
          ...prev,
          explicitProviderType: providerType,
          validationResult: result,
        }))
        return null
      }

      setState({
        isSelectingProvider: false,
        candidatePath: null,
        explicitProviderType: null,
        validationResult: null,
      })

      if (pendingCallbackRef.current) {
        pendingCallbackRef.current(result)
        pendingCallbackRef.current = null
      }

      return result
    } catch (err) {
      console.error('Failed to confirm vault provider:', err)
      return null
    }
  }, [state.candidatePath, tauriCall])

  const cancelProviderSelection = useCallback(() => {
    setState({
      isSelectingProvider: false,
      candidatePath: null,
      explicitProviderType: null,
      validationResult: null,
    })
    pendingCallbackRef.current = null
  }, [])

  return {
    isSelectingProvider: state.isSelectingProvider,
    validationResult: state.validationResult,
    inferredProvider: state.validationResult?.providerType ?? null,
    validationMessage: state.validationResult?.message ?? null,
    startProviderSelection,
    confirmProvider,
    cancelProviderSelection,
  }
}
