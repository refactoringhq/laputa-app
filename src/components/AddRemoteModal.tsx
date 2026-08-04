import { useCallback, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { GitAddRemoteResult } from '../types'
import { isTauri, mockInvoke } from '../mock-tauri'

type ConnectState = 'idle' | 'connecting'

interface AddRemoteModalProps {
  open: boolean
  vaultPath: string
  onClose: () => void
  onRemoteConnected: (message: string) => void | Promise<void>
}

function tauriCall<T>(command: string, args: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args)
}

function shouldCloseAfterResult(result: GitAddRemoteResult): boolean {
  return result.status === 'connected' || result.status === 'already_configured'
}

async function submitRemoteConnection(
  vaultPath: string,
  remoteUrl: string,
): Promise<GitAddRemoteResult> {
  return tauriCall<GitAddRemoteResult>('git_add_remote', {
    request: {
      vaultPath,
      remoteUrl,
    },
  })
}

async function getConnectErrorMessage({
  vaultPath,
  remoteUrl,
  onRemoteConnected,
  onClose,
}: {
  vaultPath: string
  remoteUrl: string
  onRemoteConnected: (message: string) => void | Promise<void>
  onClose: () => void
}): Promise<string | null> {
  try {
    const result = await submitRemoteConnection(vaultPath, remoteUrl)

    if (shouldCloseAfterResult(result)) {
      await onRemoteConnected(result.message)
      onClose()
      return null
    }

    return result.message
  } catch (error) {
    return `Could not connect that remote: ${String(error)}`
  }
}

export function AddRemoteModal(
  { open, vaultPath, onClose, onRemoteConnected }: AddRemoteModalProps,
) {
  const [remoteUrl, setRemoteUrl] = useState('')
  const [connectState, setConnectState] = useState<ConnectState>('idle')
  const [connectError, setConnectError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const resetState = useCallback(() => {
    setRemoteUrl('')
    setConnectState('idle')
    setConnectError(null)
  }, [])

  const handleClose = useCallback(() => {
    resetState()
    onClose()
  }, [onClose, resetState])

  const handleOpenChange = useCallback((isOpen: boolean) => {
    if (!isOpen) {
      handleClose()
    }
  }, [handleClose])
  const handleRemoteUrlChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setRemoteUrl(event.target.value)
    setConnectError(null)
  }, [])

  const handleSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmedUrl = remoteUrl.trim()
    if (!trimmedUrl) return

    setConnectState('connecting')
    setConnectError(null)

    const errorMessage = await getConnectErrorMessage({
      vaultPath,
      remoteUrl: trimmedUrl,
      onRemoteConnected,
      onClose: handleClose,
    })

    if (errorMessage) {
      setConnectError(errorMessage)
    }

    setConnectState('idle')
  }, [handleClose, onRemoteConnected, remoteUrl, vaultPath])

  const connectDisabled = connectState === 'connecting' || !remoteUrl.trim()

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[520px]" data-testid="add-remote-modal">
        <DialogHeader>
          <DialogTitle>Add Remote</DialogTitle>
          <DialogDescription>
            Connect this local vault to a git remote. Your existing local commits stay intact; Tolaria
            will only connect the vault when the remote history is safe to use.
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4 py-2" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground" htmlFor="add-remote-url">Repository URL</label>
            <Input
              id="add-remote-url"
              ref={inputRef}
              autoFocus
              placeholder="git@host:owner/repo.git or https://host/owner/repo.git"
              value={remoteUrl}
              onChange={handleRemoteUrlChange}
              data-testid="add-remote-url"
            />
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            Use an empty repository or one created from this vault. SSH keys, Git Credential Manager,
            and other system git auth methods all work.
          </p>

          {connectError && (
            <p className="text-xs text-destructive" data-testid="add-remote-error">{connectError}</p>
          )}

          <DialogFooter className="flex-row items-center justify-end sm:justify-end">
            <Button type="submit" disabled={connectDisabled} data-testid="add-remote-submit">
              {connectState === 'connecting' ? 'Connecting...' : 'Connect Remote'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
