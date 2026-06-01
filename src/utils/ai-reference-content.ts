import { isTauri, mockInvoke } from '../mock-tauri'
import type { NoteReference } from './ai-context'

async function readNoteContent(path: string): Promise<string | null> {
  try {
    if (!isTauri()) {
      return await mockInvoke<string>('get_note_content', { path })
    }

    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<string>('get_note_content', { path })
  } catch {
    return null
  }
}

export async function hydrateNoteReferences(references?: NoteReference[]): Promise<NoteReference[] | undefined> {
  if (!references?.length) return references

  return Promise.all(references.map(async (reference) => {
    if (reference.content !== undefined) return reference

    const content = await readNoteContent(reference.path)
    return content === null ? reference : { ...reference, content }
  }))
}
