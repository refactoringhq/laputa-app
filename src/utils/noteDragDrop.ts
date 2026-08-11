export const NOTE_DRAG_MIME_TYPE = 'application/x-tolaria-note-path'

let activeDraggedNotePath: string | null = null

export function writeNoteDragData(dataTransfer: DataTransfer, notePath: string) {
  activeDraggedNotePath = notePath
  dataTransfer.effectAllowed = 'move'
  dataTransfer.setData(NOTE_DRAG_MIME_TYPE, notePath)
  dataTransfer.setData('text/plain', notePath)
}

export function clearDraggedNotePath(): void {
  activeDraggedNotePath = null
}

export function readDraggedNotePath(dataTransfer: DataTransfer | null): string | null {
  const rawNotePath = dataTransfer?.getData(NOTE_DRAG_MIME_TYPE)
  const notePath = typeof rawNotePath === 'string' ? rawNotePath.trim() : ''
  return notePath || activeDraggedNotePath
}
