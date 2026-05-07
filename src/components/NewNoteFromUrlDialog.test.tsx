import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NewNoteFromUrlDialog } from './NewNoteFromUrlDialog'

describe('NewNoteFromUrlDialog', () => {
  it('normalizes bare domains before importing', async () => {
    const onImport = vi.fn(async () => true)
    const onClose = vi.fn()
    render(<NewNoteFromUrlDialog open onClose={onClose} onImport={onImport} />)

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'example.com/article' } })
    fireEvent.click(screen.getByText('Import'))

    await waitFor(() => {
      expect(onImport).toHaveBeenCalledWith('https://example.com/article')
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('rejects non-http URLs without closing', async () => {
    const onImport = vi.fn()
    const onClose = vi.fn()
    render(<NewNoteFromUrlDialog open onClose={onClose} onImport={onImport} />)

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'ftp://example.com/file' } })
    fireEvent.submit(screen.getByText('Import').closest('form')!)

    expect(await screen.findByText('Enter a valid web URL.')).toBeInTheDocument()
    expect(onImport).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps the dialog open when import reports failure', async () => {
    const onImport = vi.fn(async () => false)
    const onClose = vi.fn()
    render(<NewNoteFromUrlDialog open onClose={onClose} onImport={onImport} />)

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByText('Import'))

    await waitFor(() => expect(onImport).toHaveBeenCalledOnce())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('New Note from URL')).toBeInTheDocument()
  })
})
