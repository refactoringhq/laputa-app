import type { ImportNoteFromUrlResult, SidebarSelection } from '../types'

export function noteTypeForUrlImport(selection: SidebarSelection): string {
  return selection.kind === 'sectionGroup' ? selection.type : 'Note'
}

export function formatUrlImportToast(result: ImportNoteFromUrlResult): string {
  const saved = result.savedMediaCount
  const skipped = result.skippedMediaCount
  const attachmentLabel = saved === 1 ? 'attachment' : 'attachments'
  const skippedLabel = skipped === 1 ? 'media item' : 'media items'
  if (saved > 0 && skipped > 0) {
    return `Imported "${result.entry.title}" with ${saved} ${attachmentLabel}; skipped ${skipped} ${skippedLabel}`
  }
  if (saved > 0) return `Imported "${result.entry.title}" with ${saved} ${attachmentLabel}`
  if (skipped > 0) return `Imported "${result.entry.title}"; skipped ${skipped} ${skippedLabel}`
  return `Imported "${result.entry.title}"`
}
