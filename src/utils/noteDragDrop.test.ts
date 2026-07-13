import { describe, expect, it, vi } from 'vitest'
import { NOTE_DRAG_MIME_TYPE, readDraggedNotePath, writeNoteDragData } from './noteDragDrop'

function dataTransferWithGetData(getData: (type: string) => unknown): DataTransfer {
  return { getData } as DataTransfer
}

describe('note drag/drop data', () => {
  it('writes the Tolaria note path and plain text drag payloads', () => {
    const setData = vi.fn()
    const dataTransfer = { setData } as unknown as DataTransfer

    writeNoteDragData(dataTransfer, '/vault/notes/alpha.md')

    expect(dataTransfer.effectAllowed).toBe('move')
    expect(setData).toHaveBeenCalledWith(NOTE_DRAG_MIME_TYPE, '/vault/notes/alpha.md')
    expect(setData).toHaveBeenCalledWith('text/plain', '/vault/notes/alpha.md')
  })

  it('trims valid dragged note paths', () => {
    const dataTransfer = dataTransferWithGetData(() => '  /vault/notes/alpha.md  ')

    expect(readDraggedNotePath(dataTransfer)).toBe('/vault/notes/alpha.md')
  })

  it('ignores null drag payloads without crashing', () => {
    const dataTransfer = dataTransferWithGetData(() => null)

    expect(readDraggedNotePath(dataTransfer)).toBeNull()
  })
})
