import { isTauri, mockInvoke } from '../mock-tauri'
import type { NoteReference } from './ai-context'

function readNoteContent(path: string): Promise<string | null> {
  const request = isTauri()
    ? import('@tauri-apps/api/core').then(({ invoke }) => invoke<string>('get_note_content', { path }))
    : mockInvoke<string>('get_note_content', { path })
  return request.catch(() => null)
}

export async function hydrateNoteReferences(references?: NoteReference[]): Promise<NoteReference[] | undefined> {
  if (!references?.length) return references

  return Promise.all(references.map(async (reference) => {
    if (reference.content !== undefined) return reference

    const content = await readNoteContent(reference.path)
    return content === null ? reference : { ...reference, content }
  }))
}
