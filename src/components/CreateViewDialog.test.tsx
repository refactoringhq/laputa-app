import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { CreateViewDialog } from './CreateViewDialog'
import type { ViewDefinition } from '../types'

describe('CreateViewDialog', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onCreate: vi.fn(),
    availableFields: ['type', 'status', 'title'],
  }

  it('shows "Create View" title in create mode', () => {
    render(<CreateViewDialog {...defaultProps} />)
    expect(screen.getByText('Create View')).toBeInTheDocument()
    expect(screen.getByText('Create')).toBeInTheDocument()
  })

  it('shows "Edit View" title when editingView is provided', () => {
    const editingView: ViewDefinition = {
      name: 'Active Projects',
      icon: '🚀',
      color: null,
      sort: null,
      filters: { all: [{ field: 'type', op: 'equals', value: 'Project' }] },
    }
    render(<CreateViewDialog {...defaultProps} editingView={editingView} />)
    expect(screen.getByText('Edit View')).toBeInTheDocument()
    expect(screen.getByText('Save')).toBeInTheDocument()
  })

  it('pre-populates name field in edit mode', () => {
    const editingView: ViewDefinition = {
      name: 'Active Projects',
      icon: '🚀',
      color: null,
      sort: null,
      filters: { all: [{ field: 'type', op: 'equals', value: 'Project' }] },
    }
    render(<CreateViewDialog {...defaultProps} editingView={editingView} />)
    const input = screen.getByPlaceholderText(/Active Projects|Reading List/i)
    expect(input).toHaveValue('Active Projects')
  })

  it('preserves emoji icon when editing a view', async () => {
    const onCreate = vi.fn()
    const editingView: ViewDefinition = {
      name: 'Monday',
      icon: '🗂️',
      color: null,
      sort: null,
      filters: { all: [{ field: 'type', op: 'equals', value: 'Project' }] },
    }
    render(<CreateViewDialog {...defaultProps} onCreate={onCreate} editingView={editingView} />)
    // Submit the form without changing anything
    fireEvent.submit(screen.getByText('Save').closest('form')!)
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ icon: '🗂️' })
      )
    })
  })

  it('passes selected emoji icon when creating a view', async () => {
    const onCreate = vi.fn()
    render(<CreateViewDialog {...defaultProps} onCreate={onCreate} />)
    const input = screen.getByPlaceholderText(/Active Projects|Reading List/i)
    fireEvent.change(input, { target: { value: 'Test View' } })
    // Open emoji picker and select an emoji
    fireEvent.click(screen.getByTitle('Pick icon'))
    expect(screen.getByTestId('emoji-picker')).toBeInTheDocument()
    const emojiButtons = screen.getAllByTestId('emoji-option')
    fireEvent.click(emojiButtons[0])
    // Submit the form
    fireEvent.click(screen.getByText('Create'))
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    const definition = onCreate.mock.calls[0][0] as ViewDefinition
    expect(definition.icon).not.toBeNull()
    expect(typeof definition.icon).toBe('string')
    expect(definition.icon!.length).toBeGreaterThan(0)
  })

  it('passes null icon when no emoji is selected', async () => {
    const onCreate = vi.fn()
    render(<CreateViewDialog {...defaultProps} onCreate={onCreate} />)
    const input = screen.getByPlaceholderText(/Active Projects|Reading List/i)
    fireEvent.change(input, { target: { value: 'No Icon View' } })
    fireEvent.submit(screen.getByText('Create').closest('form')!)
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ icon: null })
      )
    })
  })

  it('keeps the dialog open when async save reports failure', async () => {
    const onClose = vi.fn()
    const onCreate = vi.fn(async () => false)
    render(<CreateViewDialog {...defaultProps} onClose={onClose} onCreate={onCreate} />)
    const input = screen.getByPlaceholderText(/Active Projects|Reading List/i)
    fireEvent.change(input, { target: { value: 'Unsaveable View' } })

    fireEvent.click(screen.getByText('Create'))

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Create View')).toBeInTheDocument()
  })
})
