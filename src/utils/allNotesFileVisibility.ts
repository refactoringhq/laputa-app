import type { Settings, VaultEntry } from '../types'
import { filePreviewKind } from './filePreview'

export interface AllNotesFileVisibility {
  pdfs: boolean
  images: boolean
  unsupported: boolean
}

export const DEFAULT_ALL_NOTES_FILE_VISIBILITY: AllNotesFileVisibility = {
  pdfs: false,
  images: false,
  unsupported: false,
}

type AllNotesFileVisibilitySettings = Pick<
  Settings,
  'all_notes_show_pdfs' | 'all_notes_show_images' | 'all_notes_show_unsupported'
>

export function resolveAllNotesFileVisibility(
  settings: AllNotesFileVisibilitySettings | null | undefined,
): AllNotesFileVisibility {
  return {
    pdfs: settings?.all_notes_show_pdfs === true,
    images: settings?.all_notes_show_images === true,
    unsupported: settings?.all_notes_show_unsupported === true,
  }
}

export function settingsWithAllNotesFileVisibility(
  settings: Settings,
  visibility: AllNotesFileVisibility,
): Settings {
  return {
    ...settings,
    all_notes_show_pdfs: visibility.pdfs,
    all_notes_show_images: visibility.images,
    all_notes_show_unsupported: visibility.unsupported,
  }
}

export function isOptionalAllNotesFileVisible(
  entry: Pick<VaultEntry, 'fileKind' | 'filename' | 'path'>,
  visibility: AllNotesFileVisibility,
): boolean {
  const previewKind = filePreviewKind(entry)
  if (previewKind === 'pdf') return visibility.pdfs
  if (previewKind === 'image') return visibility.images
  return visibility.unsupported
}
