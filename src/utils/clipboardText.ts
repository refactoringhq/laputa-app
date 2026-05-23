import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../mock-tauri'

const NATIVE_COPY_TEXT_COMMAND = 'copy_text_to_clipboard'

type WebClipboardResult =
  | { status: 'copied' }
  | { status: 'failed'; error: unknown }
  | { status: 'unavailable' }

function hasWebClipboard(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function'
}

async function writeWebClipboardText(text: string): Promise<WebClipboardResult> {
  if (!hasWebClipboard()) return { status: 'unavailable' }

  try {
    await navigator.clipboard.writeText(text)
    return { status: 'copied' }
  } catch (error) {
    return { status: 'failed', error }
  }
}

export async function writeClipboardText(text: string): Promise<void> {
  const webResult = await writeWebClipboardText(text)
  if (webResult.status === 'copied') return

  if (isTauri()) {
    await invoke(NATIVE_COPY_TEXT_COMMAND, { text })
    return
  }

  if (webResult.status === 'failed') throw webResult.error

  throw new Error('Clipboard API is unavailable')
}
