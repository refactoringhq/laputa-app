import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { FilterBuilder } from './FilterBuilder'
import type { FilterGroup } from '../types'

describe('FilterBuilder value inputs', () => {
  const onChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function renderBuilder(group?: FilterGroup) {
    const defaultGroup: FilterGroup = {
      all: [{ field: 'title', op: 'contains', value: '' }],
    }
    return render(
      <FilterBuilder
        group={group ?? defaultGroup}
        onChange={onChange}
        availableFields={['type', 'status', 'title']}
      />,
    )
  }

  function openFieldCombobox() {
    const input = screen.getByTestId('filter-field-combobox-input')
    fireEvent.focus(input)
    return input
  }

  it('renders a plain text input for text operators', () => {
    renderBuilder()
    expect(screen.getByTestId('filter-value-input')).toBeInTheDocument()
    expect(screen.getByTestId('filter-value-input')).toHaveAttribute('placeholder', 'value')
  })

  it('renders a regex toggle for supported text operators', () => {
    renderBuilder()
    expect(screen.getByTestId('filter-regex-toggle')).toBeInTheDocument()
    expect(screen.getByTestId('filter-regex-toggle')).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps wikilink-style values in the plain text input without opening a dropdown', () => {
    renderBuilder({
      all: [{ field: 'belongs to', op: 'contains', value: '[[Alpha Project]]' }],
    })

    const input = screen.getByTestId('filter-value-input')
    fireEvent.focus(input)

    expect(input).toHaveValue('[[Alpha Project]]')
    expect(screen.queryByTestId('wikilink-dropdown')).not.toBeInTheDocument()
  })

  it('updates filter values as raw text strings', () => {
    renderBuilder()

    fireEvent.change(screen.getByTestId('filter-value-input'), {
      target: { value: 'plain text' },
    })

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        all: [{ field: 'title', op: 'contains', value: 'plain text' }],
      }),
    )
  })

  it('keeps the value input focused while controlled filter state rerenders', () => {
    function StatefulBuilder() {
      const [group, setGroup] = useState<FilterGroup>({
        all: [{ field: 'title', op: 'contains', value: '' }],
      })

      return (
        <FilterBuilder
          group={group}
          onChange={(nextGroup) => {
            onChange(nextGroup)
            setGroup(nextGroup)
          }}
          availableFields={['type', 'status', 'title']}
        />
      )
    }

    render(<StatefulBuilder />)

    const input = screen.getByTestId('filter-value-input')
    input.focus()
    expect(input).toHaveFocus()

    fireEvent.change(input, { target: { value: 'p' } })

    const updatedInput = screen.getByTestId('filter-value-input')
    expect(updatedInput).toBe(input)
    expect(updatedInput).toHaveFocus()

    fireEvent.change(updatedInput, { target: { value: 'po' } })

    expect(screen.getByTestId('filter-value-input')).toBe(input)
    expect(screen.getByTestId('filter-value-input')).toHaveFocus()
    expect(screen.getByTestId('filter-value-input')).toHaveValue('po')
  })

  it('toggles regex mode in the emitted filter payload', () => {
    renderBuilder()

    fireEvent.click(screen.getByTestId('filter-regex-toggle'))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        all: [{ field: 'title', op: 'contains', value: '', regex: true }],
      }),
    )
  })

  it('shows an invalid-regex indicator when regex mode is enabled with a broken pattern', () => {
    renderBuilder({
      all: [{ field: 'title', op: 'contains', value: '(', regex: true }],
    })

    expect(screen.getByTestId('filter-regex-invalid')).toBeInTheDocument()
    expect(screen.getByTestId('filter-value-input')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('filter-regex-toggle')).toHaveAttribute('aria-pressed', 'true')
  })

  it('does not render a value input for empty-check operators', () => {
    renderBuilder({
      all: [{ field: 'title', op: 'is_empty' }],
    })

    expect(screen.queryByTestId('filter-value-input')).not.toBeInTheDocument()
    expect(screen.queryByTestId('filter-regex-toggle')).not.toBeInTheDocument()
  })

  it('renders calendar date picker button for date operators', () => {
    renderBuilder({
      all: [{ field: 'created', op: 'before', value: '2024-06-01' }],
    })

    expect(screen.getByTestId('date-value-input')).toHaveValue('2024-06-01')
    const dateButton = screen.getByTestId('date-picker-trigger')
    expect(dateButton).toBeInTheDocument()
    expect(dateButton).toHaveAttribute('title', 'Jun 1, 2024')
  })

  it('renders date picker placeholder when no date is selected', () => {
    renderBuilder({
      all: [{ field: 'created', op: 'after', value: '' }],
    })

    expect(screen.getByTestId('date-value-input')).toHaveValue('')
    expect(screen.getByTestId('date-picker-trigger')).toHaveAttribute('title', 'Pick a date')
    expect(screen.queryByTestId('filter-regex-toggle')).not.toBeInTheDocument()
  })

  it('allows free-text relative date phrases for date operators', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-07T12:00:00Z'))

    renderBuilder({
      all: [{ field: 'created', op: 'after', value: '10 days ago' }],
    })

    expect(screen.getByTestId('date-value-input')).toHaveValue('10 days ago')
    expect(screen.getByTestId('date-picker-trigger')).toHaveAttribute('title', 'Mar 28, 2026')
  })

  it('keeps filter controls top-aligned when the date preview adds a second line', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-07T12:00:00Z'))

    renderBuilder({
      all: [{ field: 'created', op: 'after', value: '10 days ago' }],
    })

    fireEvent.focus(screen.getByTestId('date-value-input'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(screen.getByTestId('date-value-preview')).toHaveTextContent('Resolves to March 28, 2026')
    expect(screen.getByTestId('filter-row')).toHaveClass('items-start')
  })

  it('filters the field combobox as the user types', () => {
    render(
      <FilterBuilder
        group={{ all: [{ field: 'title', op: 'contains', value: '' }] }}
        onChange={vi.fn()}
        availableFields={['type', 'status', 'title', 'Owner']}
      />,
    )

    const input = openFieldCombobox()
    fireEvent.change(input, { target: { value: 'tit' } })

    expect(screen.getByTestId('filter-field-option-title')).toBeInTheDocument()
    expect(screen.queryByTestId('filter-field-option-status')).not.toBeInTheDocument()
    expect(screen.queryByTestId('filter-field-option-Owner')).not.toBeInTheDocument()
  })

  it('supports keyboard navigation and Enter selection in the field combobox', () => {
    render(
      <FilterBuilder
        group={{ all: [{ field: 'title', op: 'contains', value: '' }] }}
        onChange={onChange}
        availableFields={['title', 'status', 'Owner']}
      />,
    )

    const input = openFieldCombobox()
    fireEvent.change(input, { target: { value: 'sta' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        all: [{ field: 'status', op: 'contains', value: '' }],
      }),
    )
  })

  it('shows an empty state when no field matches the search text', () => {
    renderBuilder()

    const input = openFieldCombobox()
    fireEvent.change(input, { target: { value: 'zzz' } })

    expect(screen.getByTestId('filter-field-combobox-empty')).toHaveTextContent('No results')
  })

  it('reopens the field combobox with the selected field prefilled and all options visible', () => {
    render(
      <FilterBuilder
        group={{ all: [{ field: 'status', op: 'contains', value: '' }] }}
        onChange={vi.fn()}
        availableFields={['type', 'status', 'title']}
      />,
    )

    const input = openFieldCombobox()

    expect(input).toHaveValue('status')
    expect(screen.getByTestId('filter-field-option-type')).toBeInTheDocument()
    expect(screen.getByTestId('filter-field-option-status')).toBeInTheDocument()
    expect(screen.getByTestId('filter-field-option-title')).toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByTestId('filter-field-combobox-options')).not.toBeInTheDocument()
  })

  it('shows body field in the searchable field combobox', () => {
    render(
      <FilterBuilder
        group={{ all: [{ field: 'body', op: 'contains', value: 'test' }] }}
        onChange={vi.fn()}
        availableFields={['type', 'status', 'body']}
      />,
    )

    openFieldCombobox()

    expect(screen.getByTestId('filter-field-option-body')).toBeInTheDocument()
  })
})
