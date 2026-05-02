import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useVaultProviderState } from './useVaultProviderState'

const mockInvokeFn = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd, args) => mockInvokeFn(cmd, args)),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: (cmd: string, args: Record<string, unknown>) => mockInvokeFn(cmd, args),
}))

describe('useVaultProviderState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts selection and requires confirmation for inferred iCloud', async () => {
    mockInvokeFn.mockResolvedValueOnce({
      validationResult: 'valid',
      providerType: 'icloud-drive',
      providerRoot: '/icloud',
      message: null,
    })

    const { result } = renderHook(() => useVaultProviderState())
    const onComplete = vi.fn()

    let actionResult: { needsConfirmation: boolean; result: unknown } | undefined
    await act(async () => {
      actionResult = await result.current.startProviderSelection('/icloud', null, onComplete)
    })

    expect(actionResult?.needsConfirmation).toBe(true)
    expect(result.current.isSelectingProvider).toBe(true)
    expect(result.current.validationResult?.providerType).toBe('icloud-drive')
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('skips confirmation for inferred local folder', async () => {
    mockInvokeFn.mockResolvedValueOnce({
      validationResult: 'valid',
      providerType: 'local-folder',
      providerRoot: '/local',
      message: null,
    })

    const { result } = renderHook(() => useVaultProviderState())
    const onComplete = vi.fn()

    let actionResult: { needsConfirmation: boolean; result: unknown } | undefined
    await act(async () => {
      actionResult = await result.current.startProviderSelection('/local', null, onComplete)
    })

    expect(actionResult?.needsConfirmation).toBe(false)
    expect(result.current.isSelectingProvider).toBe(false)
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ providerType: 'local-folder' }))
  })

  it('confirms a valid provider selection', async () => {
    mockInvokeFn.mockResolvedValueOnce({
      validationResult: 'valid',
      providerType: 'icloud-drive',
      providerRoot: '/icloud',
      message: null,
    })

    const { result } = renderHook(() => useVaultProviderState())
    const onComplete = vi.fn()

    await act(async () => {
      await result.current.startProviderSelection('/icloud', null, onComplete)
    })

    mockInvokeFn.mockResolvedValueOnce({
      validationResult: 'valid',
      providerType: 'icloud-drive',
      providerRoot: '/icloud',
      message: null,
    })

    let confirmResult: unknown
    await act(async () => {
      confirmResult = await result.current.confirmProvider('icloud-drive')
    })

    expect(confirmResult).toMatchObject({
      validationResult: 'valid',
      providerType: 'icloud-drive',
    })
    expect(result.current.isSelectingProvider).toBe(false)
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ providerType: 'icloud-drive' }))
  })

  it('cancels provider selection', async () => {
    mockInvokeFn.mockResolvedValueOnce({
      validationResult: 'valid',
      providerType: 'icloud-drive',
      providerRoot: '/icloud',
      message: null,
    })

    const { result } = renderHook(() => useVaultProviderState())
    const onComplete = vi.fn()

    await act(async () => {
      await result.current.startProviderSelection('/icloud', null, onComplete)
    })
    expect(result.current.isSelectingProvider).toBe(true)

    act(() => {
      result.current.cancelProviderSelection()
    })
    expect(result.current.isSelectingProvider).toBe(false)
    expect(onComplete).not.toHaveBeenCalled()
  })
})
