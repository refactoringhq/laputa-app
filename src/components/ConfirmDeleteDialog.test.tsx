import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'

const defaultProps = {
  open: true,
  title: 'Delete permanently?',
  message: 'This cannot be undone.',
}

const onConfirm = vi.fn()
const onCancel = vi.fn()

function renderDialog(overrides: Partial<React.ComponentProps<typeof ConfirmDeleteDialog>> = {}) {
  return render(
    <ConfirmDeleteDialog
      {...defaultProps}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  )
}

describe('ConfirmDeleteDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders with title and message', () => {
    renderDialog()
    expect(screen.getByText('Delete permanently?')).toBeInTheDocument()
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()
  })

  it('calls onConfirm when delete button clicked', () => {
    renderDialog()
    fireEvent.click(screen.getByTestId('confirm-delete-btn'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('focuses the destructive action when the dialog opens', async () => {
    renderDialog()

    await waitFor(() => {
      expect(screen.getByTestId('confirm-delete-btn')).toHaveFocus()
    })
  })

  it('submits the destructive action when Enter is pressed', async () => {
    renderDialog()

    fireEvent.keyDown(window, { key: 'Enter' })

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })
  })

  it('does not submit twice when Enter repeats', async () => {
    renderDialog()

    fireEvent.keyDown(window, { key: 'Enter' })
    fireEvent.keyDown(window, { key: 'Enter', repeat: true })

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })
  })

  it('treats Enter as the primary confirm shortcut even from the cancel button', async () => {
    renderDialog()

    fireEvent.keyDown(screen.getByText('Cancel'), { key: 'Enter' })

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })
  })

  it('calls onCancel when cancel button clicked', () => {
    renderDialog()
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('does not render when open is false', () => {
    renderDialog({ open: false })
    expect(screen.queryByText('Delete permanently?')).not.toBeInTheDocument()
  })

  it('uses custom confirm label when provided', () => {
    renderDialog({
      title: 'Empty Trash?',
      message: 'Delete all notes?',
      confirmLabel: 'Empty Trash',
    })
    expect(screen.getByText('Empty Trash')).toBeInTheDocument()
  })
})
