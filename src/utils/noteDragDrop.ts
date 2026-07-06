export const NOTE_DRAG_MIME_TYPE = 'application/x-tolaria-note-path'

export function writeNoteDragData(dataTransfer: DataTransfer, notePath: string) {
  dataTransfer.effectAllowed = 'move'
  dataTransfer.setData(NOTE_DRAG_MIME_TYPE, notePath)
  dataTransfer.setData('text/plain', notePath)
}

export function readDraggedNotePath(dataTransfer: DataTransfer | null): string | null {
  const notePath = dataTransfer?.getData(NOTE_DRAG_MIME_TYPE).trim()
  return notePath || null
}
