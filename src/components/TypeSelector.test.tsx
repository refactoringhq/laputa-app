import type { ComponentProps } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TypeSelector } from './TypeSelector'

const AVAILABLE_TYPES = ['Project', 'Person', 'Topic']

function renderTypeSelector(overrides: Partial<ComponentProps<typeof TypeSelector>> = {}) {
  const onUpdateProperty = vi.fn()
  render(
    <TypeSelector
      isA={null}
      customColorKey={null}
      availableTypes={AVAILABLE_TYPES}
      typeColorKeys={{ Project: null, Person: null, Topic: null }}
      typeIconKeys={{ Project: null, Person: null, Topic: null }}
      onUpdateProperty={onUpdateProperty}
      {...overrides}
    />,
  )
  return { onUpdateProperty }
}

function openTypeCombobox() {
  fireEvent.pointerDown(screen.getByRole('combobox'), { button: 0, pointerType: 'mouse' })
}

describe('TypeSelector', () => {
  it('opens from the keyboard and focuses the search input', async () => {
    renderTypeSelector({ isA: 'Project' })

    const trigger = screen.getByRole('combobox')
    trigger.focus()
    await act(async () => {
      fireEvent.keyDown(trigger, { key: 'Enter' })
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve())
      })
    })

    const searchInput = await screen.findByTestId('type-selector-search-input', {}, { timeout: 5_000 })
    await waitFor(() => expect(searchInput).toHaveFocus(), { timeout: 5_000 })
    expect(screen.getByRole('option', { name: 'Project' })).toHaveAttribute('aria-selected', 'true')
  }, 10_000)

  it('filters available types as the user types', () => {
    renderTypeSelector()

    openTypeCombobox()
    fireEvent.change(screen.getByTestId('type-selector-search-input'), { target: { value: 'per' } })

    expect(screen.getByRole('option', { name: 'Person' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Project' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Topic' })).not.toBeInTheDocument()
  })

  it('selects the highlighted type with ArrowDown and Enter', () => {
    const { onUpdateProperty } = renderTypeSelector()

    openTypeCombobox()
    const searchInput = screen.getByTestId('type-selector-search-input')
    fireEvent.change(searchInput, { target: { value: 'p' } })
    fireEvent.keyDown(searchInput, { key: 'ArrowDown' })
    fireEvent.keyDown(searchInput, { key: 'Enter' })

    expect(onUpdateProperty).toHaveBeenCalledWith('type', 'Project')
  })

  it('clears the current type when None is selected', () => {
    const { onUpdateProperty } = renderTypeSelector({ isA: 'Project' })

    openTypeCombobox()
    fireEvent.click(screen.getByRole('option', { name: 'None' }))

    expect(onUpdateProperty).toHaveBeenCalledWith('type', null)
  })

  it('closes on Escape without changing the type', () => {
    const { onUpdateProperty } = renderTypeSelector({ isA: 'Project' })

    openTypeCombobox()
    fireEvent.keyDown(screen.getByTestId('type-selector-search-input'), { key: 'Escape' })

    expect(screen.queryByTestId('type-selector-search-input')).not.toBeInTheDocument()
    expect(onUpdateProperty).not.toHaveBeenCalled()
  })

  it('shows a custom current type even when it is not in the available list', () => {
    renderTypeSelector({ isA: 'Custom Type' })

    openTypeCombobox()

    expect(screen.getByRole('option', { name: 'Custom Type' })).toHaveAttribute('aria-selected', 'true')
  })
})
