import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearDraggedNotePath, writeNoteDragData } from '../utils/noteDragDrop'
import { useSidebarNoteDropTargets } from './useSidebarNoteDropTargets'

const NOTE_PATH = '/vault/notes/alpha.md'

function dataTransfer(options?: { readable?: boolean }): DataTransfer {
  const values = new Map<string, string>()
  return {
    dropEffect: 'none',
    effectAllowed: 'uninitialized',
    getData: vi.fn((type: string) => (options?.readable === false ? '' : (values.get(type) ?? ''))),
    setData: vi.fn((type: string, value: string) => values.set(type, value)),
  } as unknown as DataTransfer
}

function beginNoteDrag(): DataTransfer {
  const transfer = dataTransfer()
  writeNoteDragData(transfer, NOTE_PATH)
  return transfer
}

function DropTargets(options: {
  canDropType?: boolean
  canDropFolder?: boolean
  changeNoteType: (notePath: string, type: string) => Promise<unknown>
  moveNoteToFolder: (notePath: string, folderPath: string) => Promise<unknown>
}) {
  useSidebarNoteDropTargets({
    canDropNoteOnType: () => options.canDropType ?? true,
    canDropNoteOnFolder: () => options.canDropFolder ?? true,
    changeNoteType: options.changeNoteType,
    moveNoteToFolder: options.moveNoteToFolder,
  })

  return (
    <div data-note-drop-type="Project" data-testid="type-target">
      <span data-testid="type-child">Project</span>
      <div data-note-drop-folder="archive" data-testid="folder-target">
        <span data-testid="folder-child">Archive</span>
      </div>
    </div>
  )
}

describe('useSidebarNoteDropTargets', () => {
  afterEach(() => clearDraggedNotePath())

  it('highlights one valid target without flicker across its child content', () => {
    beginNoteDrag()
    const changeNoteType = vi.fn()
    const moveNoteToFolder = vi.fn()
    const view = render(<DropTargets changeNoteType={changeNoteType} moveNoteToFolder={moveNoteToFolder} />)
    const lockedTransfer = dataTransfer({ readable: false })
    const target = screen.getByTestId('type-target')
    const child = screen.getByTestId('type-child')

    fireEvent.dragEnter(child, { dataTransfer: lockedTransfer })
    view.rerender(<DropTargets changeNoteType={changeNoteType} moveNoteToFolder={moveNoteToFolder} />)
    fireEvent.dragOver(child, { dataTransfer: lockedTransfer })
    fireEvent.dragLeave(child, {
      dataTransfer: lockedTransfer,
      relatedTarget: target,
    })

    expect(target).toHaveAttribute('data-note-drop-state', 'valid')
    expect(lockedTransfer.dropEffect).toBe('move')
  })

  it('runs only the closest destination mutation and clears hover state', async () => {
    const transfer = beginNoteDrag()
    const changeNoteType = vi.fn().mockResolvedValue('updated')
    const moveNoteToFolder = vi.fn().mockResolvedValue('updated')
    render(<DropTargets changeNoteType={changeNoteType} moveNoteToFolder={moveNoteToFolder} />)
    const typeTarget = screen.getByTestId('type-target')
    const folderTarget = screen.getByTestId('folder-target')

    fireEvent.dragEnter(folderTarget, { dataTransfer: transfer })
    fireEvent.drop(screen.getByTestId('folder-child'), {
      dataTransfer: transfer,
    })

    await waitFor(() => expect(moveNoteToFolder).toHaveBeenCalledWith(NOTE_PATH, 'archive'))
    expect(changeNoteType).not.toHaveBeenCalled()
    expect(typeTarget).not.toHaveAttribute('data-note-drop-state')
    expect(folderTarget).not.toHaveAttribute('data-note-drop-state')
  })

  it('does not highlight or mutate invalid and no-op destinations', () => {
    const transfer = beginNoteDrag()
    const changeNoteType = vi.fn()
    render(<DropTargets canDropType={false} changeNoteType={changeNoteType} moveNoteToFolder={vi.fn()} />)
    const target = screen.getByTestId('type-target')

    fireEvent.dragOver(target, { dataTransfer: transfer })
    fireEvent.drop(target, { dataTransfer: transfer })

    expect(target).not.toHaveAttribute('data-note-drop-state')
    expect(transfer.dropEffect).toBe('none')
    expect(changeNoteType).not.toHaveBeenCalled()
  })

  it('clears the active highlight when the drag is cancelled', () => {
    const transfer = beginNoteDrag()
    render(<DropTargets changeNoteType={vi.fn()} moveNoteToFolder={vi.fn()} />)
    const target = screen.getByTestId('type-target')

    fireEvent.dragEnter(target, { dataTransfer: transfer })
    expect(target).toHaveAttribute('data-note-drop-state', 'valid')

    fireEvent.dragEnd(document, { dataTransfer: transfer })
    expect(target).not.toHaveAttribute('data-note-drop-state')
  })
})
