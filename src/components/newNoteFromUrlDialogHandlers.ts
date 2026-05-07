import type { ChangeEvent, Dispatch, FormEvent, SetStateAction } from 'react'
import type { createTranslator } from '../lib/i18n'
import { normalizeExternalUrl } from '../utils/url'

type Translator = ReturnType<typeof createTranslator>

interface SubmitHandlerParams {
  url: string
  t: Translator
  onImport: (url: string) => boolean | Promise<boolean>
  onClose: () => void
  setError: Dispatch<SetStateAction<string | null>>
  setImporting: Dispatch<SetStateAction<boolean>>
}

interface UrlChangeHandlerParams {
  error: string | null
  setUrl: Dispatch<SetStateAction<string>>
  setError: Dispatch<SetStateAction<string | null>>
}

interface ResetHandlerParams {
  setUrl: Dispatch<SetStateAction<string>>
  setError: Dispatch<SetStateAction<string | null>>
  setImporting: Dispatch<SetStateAction<boolean>>
}

export function createCloseHandler(onClose: () => void, params: ResetHandlerParams) {
  return () => {
    resetDialogState(params)
    onClose()
  }
}

function resetDialogState(params: ResetHandlerParams): void {
  params.setUrl('')
  params.setError(null)
  params.setImporting(false)
}

export function createSubmitHandler(params: SubmitHandlerParams) {
  return (event: FormEvent) => {
    void submitUrlImport(event, params)
  }
}

async function submitUrlImport(event: FormEvent, params: SubmitHandlerParams): Promise<void> {
  event.preventDefault()
  const normalized = normalizeExternalUrl(params.url)
  if (!normalized) {
    params.setError(params.t('urlImport.invalidUrl'))
    return
  }

  params.setImporting(true)
  params.setError(null)
  try {
    const imported = await params.onImport(normalized)
    if (imported !== false) params.onClose()
  } finally {
    params.setImporting(false)
  }
}

export function createOpenChangeHandler(importing: boolean, onClose: () => void) {
  return (isOpen: boolean) => {
    if (!isOpen && !importing) onClose()
  }
}

export function createUrlChangeHandler(params: UrlChangeHandlerParams) {
  return (event: ChangeEvent<HTMLInputElement>) => {
    params.setUrl(event.target.value)
    if (params.error) params.setError(null)
  }
}
