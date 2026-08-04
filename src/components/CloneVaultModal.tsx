import { type ChangeEvent, type FormEvent, useCallback, useRef, useState } from 'react'
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
import { isTauri, mockInvoke } from '../mock-tauri'

type CloneStatus = 'idle' | 'cloning' | 'error'
type CloneAttemptResult =
  | { ok: true }
  | { ok: false; errorMessage: string }
type CloneRequest = Record<string, unknown> & {
  url: string
  localPath: string
}

interface CloneVaultModalProps {
  open: boolean
  onClose: () => void
  onVaultCloned: (path: string, label: string) => void
}

interface CloneVaultFormState {
  repoUrl: string
  localPath: string
  cloneStatus: CloneStatus
  cloneError: string | null
  isCloning: boolean
  isCloneDisabled: boolean
  handleClose: () => void
  handleRepoUrlChange: (event: ChangeEvent<HTMLInputElement>) => void
  handleLocalPathChange: (event: ChangeEvent<HTMLInputElement>) => void
  handleClone: () => Promise<void>
}

interface CloneVaultInputsProps {
  repoUrl: string
  localPath: string
  isCloning: boolean
  handleRepoUrlChange: (event: ChangeEvent<HTMLInputElement>) => void
  handleLocalPathChange: (event: ChangeEvent<HTMLInputElement>) => void
}

function tauriCall<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(cmd, args) : mockInvoke<T>(cmd, args)
}

function repoNameFromUrl(request: Pick<CloneRequest, 'url'>): string {
  const trimmed = request.url.trim().replace(/\/+$/g, '')
  if (!trimmed) return ''
  const segment = trimmed.split(/[/:]/).pop() ?? ''
  return segment.replace(/\.git$/i, '')
}

function suggestedPathFromUrl(request: Pick<CloneRequest, 'url'>): string {
  const repoName = repoNameFromUrl(request)
  return repoName ? `~/Vaults/${repoName}` : ''
}

function labelFromPath(request: Pick<CloneRequest, 'localPath'>): string {
  const trimmed = request.localPath.trim().replace(/\/+$/g, '')
  return trimmed.split('/').pop() || 'Vault'
}

function shouldSyncSuggestedPath(localPath: string, pathDirty: boolean, previousSuggestedPath: string): boolean {
  return !pathDirty || !localPath.trim() || localPath === previousSuggestedPath
}

async function attemptClone(request: CloneRequest): Promise<CloneAttemptResult> {
  try {
    await tauriCall<string>('clone_git_repo', request)
    return { ok: true }
  } catch (error) {
    return { ok: false, errorMessage: `Clone failed: ${String(error)}` }
  }
}

function useCloneVaultForm(onClose: () => void, onVaultCloned: (path: string, label: string) => void): CloneVaultFormState {
  const [repoUrl, setRepoUrl] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [pathDirty, setPathDirty] = useState(false)
  const [cloneStatus, setCloneStatus] = useState<CloneStatus>('idle')
  const [cloneError, setCloneError] = useState<string | null>(null)
  const cloneInFlightRef = useRef(false)
  const previousSuggestedPathRef = useRef('')

  const resetState = useCallback(() => {
    setRepoUrl('')
    setLocalPath('')
    setPathDirty(false)
    setCloneStatus('idle')
    setCloneError(null)
    previousSuggestedPathRef.current = ''
  }, [])

  const handleClose = useCallback(() => {
    if (cloneInFlightRef.current) return
    resetState()
    onClose()
  }, [onClose, resetState])

  const handleRepoUrlChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    setRepoUrl(value)
    setCloneError(null)

    const nextSuggestedPath = suggestedPathFromUrl({ url: value })
    const previousSuggestedPath = previousSuggestedPathRef.current

    if (shouldSyncSuggestedPath(localPath, pathDirty, previousSuggestedPath)) {
      setLocalPath(nextSuggestedPath)
    }

    previousSuggestedPathRef.current = nextSuggestedPath
  }, [localPath, pathDirty])

  const handleLocalPathChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    setPathDirty(true)
    setLocalPath(value)
    setCloneError(null)
  }, [])

  const handleClone = useCallback(async () => {
    const trimmedUrl = repoUrl.trim()
    const trimmedPath = localPath.trim()
    const request = { url: trimmedUrl, localPath: trimmedPath }
    if (!request.url || !request.localPath || cloneInFlightRef.current) return

    cloneInFlightRef.current = true
    setCloneStatus('cloning')
    setCloneError(null)
    const result = await attemptClone(request)
    cloneInFlightRef.current = false

    if (result.ok) {
      onVaultCloned(request.localPath, labelFromPath({ localPath: request.localPath }))
      handleClose()
      return
    }

    setCloneStatus('error')
    setCloneError(result.errorMessage)
  }, [handleClose, localPath, onVaultCloned, repoUrl])

  const isCloning = cloneStatus === 'cloning'

  return {
    repoUrl,
    localPath,
    cloneStatus,
    cloneError,
    isCloning,
    isCloneDisabled: !repoUrl.trim() || !localPath.trim() || isCloning,
    handleClose,
    handleRepoUrlChange,
    handleLocalPathChange,
    handleClone,
  }
}

function CloneVaultInputs(options: CloneVaultInputsProps) {
  const { repoUrl, localPath, isCloning, handleRepoUrlChange, handleLocalPathChange } = options
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-foreground" htmlFor="clone-repo-url">Repository URL</label>
        <Input
          id="clone-repo-url"
          placeholder="git@host:owner/repo.git or https://host/owner/repo.git"
          value={repoUrl}
          disabled={isCloning}
          onChange={handleRepoUrlChange}
          data-testid="clone-repo-url"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-foreground" htmlFor="clone-vault-path">Clone to</label>
        <Input
          id="clone-vault-path"
          placeholder="~/Vaults/my-vault"
          value={localPath}
          disabled={isCloning}
          onChange={handleLocalPathChange}
          data-testid="clone-vault-path"
        />
      </div>
    </>
  )
}

function CloneVaultForm(form: CloneVaultFormState) {
  const { handleClone } = form
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void handleClone()
  }, [handleClone])
  return (
    <form className="flex flex-col gap-4 py-2" onSubmit={handleSubmit} data-testid="clone-vault-form" aria-busy={form.isCloning}>
      <CloneVaultInputs {...form} />
      <p className="text-xs text-muted-foreground">
        {form.isCloning
          ? 'Cloning repository… Tolaria will open the vault when git finishes.'
          : 'SSH keys, the git credential manager, `gh auth`, and other system git auth methods all work.'}
      </p>
      {form.cloneError && (
        <p className="text-xs text-destructive" data-testid="clone-vault-error">{form.cloneError}</p>
      )}
      <DialogFooter className="flex-row items-center justify-end sm:justify-end">
        <Button type="button" variant="outline" onClick={form.handleClose} disabled={form.isCloning} data-testid="clone-vault-cancel">
          Cancel
        </Button>
        <Button type="submit" disabled={form.isCloneDisabled} data-testid="clone-vault-submit">
          {form.cloneStatus === 'cloning' ? 'Cloning...' : 'Clone & Open'}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function CloneVaultModal({ open, onClose, onVaultCloned }: CloneVaultModalProps) {
  const form = useCloneVaultForm(onClose, onVaultCloned)
  const { handleClose, isCloning } = form
  const handleOpenChange = useCallback((isOpen: boolean) => {
    if (!isOpen && !isCloning) handleClose()
  }, [handleClose, isCloning])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[520px]" data-testid="clone-vault-modal">
        <DialogHeader>
          <DialogTitle>Clone Git Repo</DialogTitle>
          <DialogDescription>
            Clone any remote repository into a local vault folder. Tolaria uses your existing system git
            configuration for authentication.
          </DialogDescription>
        </DialogHeader>

        <CloneVaultForm {...form} />
      </DialogContent>
    </Dialog>
  )
}
