import { useEffect } from 'react'
import type { ImmediateCreateOptions } from './useNoteCreation'

export const CREATE_NOTE_IN_FOLDER_EVENT = 'tolaria:create-note-in-folder'

interface CreateNoteInFolderDetail {
  folderPath: string
  rootPath?: string
}

type ImmediateCreate = (type?: string, options?: ImmediateCreateOptions) => void

export function requestCreateNoteInFolder(folderPath: string, rootPath?: string): void {
  window.dispatchEvent(new CustomEvent<CreateNoteInFolderDetail>(CREATE_NOTE_IN_FOLDER_EVENT, {
    detail: { folderPath, rootPath },
  }))
}

export function useCreateNoteInFolderRequests(createNote: ImmediateCreate): void {
  useEffect(() => {
    const handleCreateNoteInFolder = (event: Event) => {
      const { folderPath, rootPath } = (event as CustomEvent<CreateNoteInFolderDetail>).detail
      createNote(undefined, {
        creationPath: 'folder_context_menu',
        folderPath,
        vaultPath: rootPath,
      })
    }

    window.addEventListener(CREATE_NOTE_IN_FOLDER_EVENT, handleCreateNoteInFolder)
    return () => window.removeEventListener(CREATE_NOTE_IN_FOLDER_EVENT, handleCreateNoteInFolder)
  }, [createNote])
}
