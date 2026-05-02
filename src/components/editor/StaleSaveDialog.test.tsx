import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StaleSaveDialog } from './StaleSaveDialog'
import '@testing-library/jest-dom'

describe('StaleSaveDialog', () => {
  it('shows the filename and recovery options when open', () => {
    render(
      <StaleSaveDialog
        open={true}
        notePath="/vault/my-note.md"
        onReloadFromDisk={vi.fn()}
        onDuplicateLocalDraft={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByText('File changed on disk')).toBeInTheDocument()
    expect(screen.getByText('my-note.md')).toBeInTheDocument()
    expect(screen.getByTestId('stale-save-reload')).toBeInTheDocument()
    expect(screen.getByTestId('stale-save-duplicate')).toBeInTheDocument()
  })

  it('calls onReloadFromDisk when reload is clicked', () => {
    const onReload = vi.fn()
    render(
      <StaleSaveDialog
        open={true}
        notePath="/vault/note.md"
        onReloadFromDisk={onReload}
        onDuplicateLocalDraft={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    fireEvent.click(screen.getByTestId('stale-save-reload'))
    expect(onReload).toHaveBeenCalledOnce()
  })

  it('calls onDuplicateLocalDraft when duplicate is clicked', () => {
    const onDuplicate = vi.fn()
    render(
      <StaleSaveDialog
        open={true}
        notePath="/vault/note.md"
        onReloadFromDisk={vi.fn()}
        onDuplicateLocalDraft={onDuplicate}
        onCancel={vi.fn()}
      />
    )

    fireEvent.click(screen.getByTestId('stale-save-duplicate'))
    expect(onDuplicate).toHaveBeenCalledOnce()
  })
})
