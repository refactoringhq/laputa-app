import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConflictFileState } from '../hooks/useConflictResolver'

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    children: React.ReactNode
  }) => (
    open ? (
      <div data-testid="dialog-root">
        {children}
        <button type="button" data-testid="dialog-close" onClick={() => onOpenChange(false)}>close</button>
      </div>
    ) : null
  ),
  DialogContent: ({
    children,
    onKeyDown,
  }: {
    children: React.ReactNode
    onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void
  }) => (
    <dialog open onKeyDown={onKeyDown}>
      {children}
    </dialog>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

import { ConflictResolverModal } from './ConflictResolverModal'

function makeFileStates(overrides?: Partial<ConflictFileState>[]): ConflictFileState[] {
  const defaults: ConflictFileState[] = [
    { file: 'notes/project.md', resolution: null, resolving: false },
    { file: 'notes/plan.md', resolution: null, resolving: false },
  ]
  if (!overrides) return defaults
  return defaults.map((state, index) => ({ ...state, ...(overrides[index] ?? {}) }))
}

function renderModal(overrides: Partial<React.ComponentProps<typeof ConflictResolverModal>> = {}) {
  const props: React.ComponentProps<typeof ConflictResolverModal> = {
    open: true,
    fileStates: makeFileStates(),
    allResolved: false,
    committing: false,
    error: null,
    onResolveFile: vi.fn(),
    onOpenInEditor: vi.fn(),
    onCommit: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }

  render(<ConflictResolverModal {...props} />)
  return props
}

describe('ConflictResolverModal keyboard behavior', () => {
  it('navigates rows with the keyboard and routes shortcuts to the focused file', () => {
    const props = renderModal()
    const dialog = screen.getByRole('dialog')

    fireEvent.keyDown(dialog, { key: 'ArrowDown' })
    fireEvent.keyDown(dialog, { key: 'k' })
    expect(props.onResolveFile).toHaveBeenCalledWith('notes/plan.md', 'ours')

    fireEvent.keyDown(dialog, { key: 'ArrowUp' })
    fireEvent.keyDown(dialog, { key: 'T' })
    expect(props.onResolveFile).toHaveBeenCalledWith('notes/project.md', 'theirs')

    fireEvent.keyDown(dialog, { key: 'o' })
    expect(props.onOpenInEditor).toHaveBeenCalledWith('notes/project.md')
  })

  it('commits on Enter when all files are resolved and closes through Escape and open-change callbacks', () => {
    const props = renderModal({ allResolved: true })
    const dialog = screen.getByRole('dialog')

    fireEvent.keyDown(dialog, { key: 'Enter' })
    expect(props.onCommit).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('dialog-close'))
    expect(props.onClose).toHaveBeenCalledTimes(2)
  })

  it('ignores shortcut variants that should be blocked', () => {
    const props = renderModal({
      fileStates: [{ file: 'images/photo.png', resolution: null, resolving: true }],
    })
    const dialog = screen.getByRole('dialog')

    fireEvent.keyDown(dialog, { key: 'k' })
    fireEvent.keyDown(dialog, { key: 'o' })
    fireEvent.keyDown(dialog, { key: 't', metaKey: true })

    expect(props.onResolveFile).not.toHaveBeenCalled()
    expect(props.onOpenInEditor).not.toHaveBeenCalled()
  })
})
