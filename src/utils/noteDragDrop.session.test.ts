import { describe, expect, it, vi } from 'vitest'
import { clearDraggedNotePath, readDraggedNotePath, writeNoteDragData } from './noteDragDrop'

function dataTransfer(options?: { readable?: boolean }): DataTransfer {
  const values = new Map<string, string>()
  return {
    effectAllowed: 'uninitialized',
    getData: vi.fn((type: string) => (options?.readable === false ? '' : (values.get(type) ?? ''))),
    setData: vi.fn((type: string, value: string) => values.set(type, value)),
  } as unknown as DataTransfer
}

describe('note drag session', () => {
  it('keeps the active note identity available while dragover payload reads are locked', () => {
    const sourceTransfer = dataTransfer()
    const lockedTransfer = dataTransfer({ readable: false })

    writeNoteDragData(sourceTransfer, '/vault/notes/alpha.md')

    expect(readDraggedNotePath(lockedTransfer)).toBe('/vault/notes/alpha.md')

    clearDraggedNotePath()
    expect(readDraggedNotePath(lockedTransfer)).toBeNull()
  })
})
