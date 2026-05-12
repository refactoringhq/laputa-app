import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const { createDropdownModule, createPrimarySecondaryActions } = vi.hoisted(() => {
  const renderMockActionMenu = (
    containerTestId: string,
    actions: Array<{ testId: string; label: string; onClick: () => void }>,
  ) => (
    <div data-testid={containerTestId}>
      {actions.map(({ testId, label, onClick }) => (
        <button key={testId} data-testid={testId} onClick={onClick}>
          {label}
        </button>
      ))}
    </div>
  )

  const createDropdownModule = (
    exportName: string,
    containerTestId: string,
    createActions: (callbacks: Record<string, (...args: never[]) => void>) => Array<{
      testId: string
      label: string
      onClick: () => void
    }>,
  ) => ({
    [exportName]: (callbacks: Record<string, (...args: never[]) => void>) =>
      renderMockActionMenu(containerTestId, createActions(callbacks)),
  })

  const createPrimarySecondaryActions = (options: {
    primary: { testId: string; label: string; onClick: () => void }
    secondary: { testId: string; label: string; onClick: () => void }
  }) => [options.primary, options.secondary]

  return { createDropdownModule, createPrimarySecondaryActions }
})

vi.mock('./EditableValue', () => ({
  EditableValue: ({ value, onSave }: { value: string; onSave: (value: string) => void }) => (
    <button data-testid="editable-value" onClick={() => onSave(`${value}-saved`)}>
      {value}
    </button>
  ),
  TagPillList: ({
    items,
    label,
    onSave,
  }: {
    items: string[]
    label: string
    onSave: (items: string[]) => void
  }) => (
    <button data-testid="tag-pill-list" onClick={() => onSave([...items, 'gamma'])}>
      {label}:{items.join(',')}
    </button>
  ),
  UrlValue: ({ value, onSave }: { value: string; onSave: (value: string) => void }) => (
    <button data-testid="url-value" onClick={() => onSave('https://saved.example')}>
      {value}
    </button>
  ),
}))

vi.mock('./StatusDropdown', () =>
  createDropdownModule('StatusDropdown', 'status-dropdown', ({ onSave, onCancel }) =>
    createPrimarySecondaryActions({
      primary: { testId: 'status-save', label: 'save', onClick: () => onSave('Done') },
      secondary: { testId: 'status-cancel', label: 'cancel', onClick: onCancel },
    })),
)

vi.mock('./TagsDropdown', () =>
  createDropdownModule('TagsDropdown', 'tags-dropdown', ({ onToggle, onClose }) =>
    createPrimarySecondaryActions({
      primary: { testId: 'tags-toggle', label: 'toggle', onClick: () => onToggle('beta') },
      secondary: { testId: 'tags-close', label: 'close', onClick: onClose },
    })),
)

vi.mock('./ColorInput', () => ({
  ColorEditableValue: ({ value, onSave }: { value: string; onSave: (value: string) => void }) => (
    <button data-testid="color-value" onClick={() => onSave('#00ff00')}>
      {value}
    </button>
  ),
}))

vi.mock('./IconEditableValue', () => ({
  IconEditableValue: ({ value, onSave }: { value: string; onSave: (value: string) => void }) => (
    <button data-testid="icon-value" onClick={() => onSave('sparkles')}>
      {value}
    </button>
  ),
}))

vi.mock('@/components/ui/calendar', () => ({
  Calendar: ({ onSelect }: { onSelect: (value: Date) => void }) => (
    <button
      data-testid="date-picker-calendar"
      onClick={() => onSelect(new Date(2026, 3, 22))}
    >
      pick
    </button>
  ),
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
}))

import { DisplayModeSelector, SmartPropertyValueCell } from './PropertyValueCells'
import { AppPreferencesProvider } from '../hooks/useAppPreferences'

describe('PropertyValueCells', () => {
  it('shows the relationship icon and resets to auto mode when the auto option is selected', () => {
    const onSelect = vi.fn()

    render(
      <DisplayModeSelector
        propKey="Related to"
        currentMode="text"
        autoMode="number"
        onSelect={onSelect}
      />,
    )

    expect(screen.getByTestId('display-mode-icon-relationship')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('display-mode-trigger'))
    fireEvent.click(screen.getByTestId('display-mode-option-number'))

    expect(onSelect).toHaveBeenCalledWith('Related to', null)
  })

  it('selects explicit display modes from the menu', () => {
    const onSelect = vi.fn()

    render(
      <DisplayModeSelector
        propKey="Status"
        currentMode="status"
        autoMode="text"
        onSelect={onSelect}
      />,
    )

    fireEvent.click(screen.getByTestId('display-mode-trigger'))
    fireEvent.click(screen.getByTestId('display-mode-option-date'))

    expect(onSelect).toHaveBeenCalledWith('Status', 'date')
  })

  it('handles status and tags editing interactions', () => {
    const onSave = vi.fn()
    const onSaveList = vi.fn()
    const onStartEdit = vi.fn()

    const { rerender } = render(
      <SmartPropertyValueCell
        propKey="Status"
        value="Doing"
        displayMode="status"
        isEditing={true}
        vaultStatuses={['Doing', 'Done']}
        vaultTags={[]}
        onStartEdit={onStartEdit}
        onSave={onSave}
        onSaveList={onSaveList}
      />,
    )

    fireEvent.click(screen.getByTestId('status-save'))
    fireEvent.click(screen.getByTestId('status-cancel'))

    expect(onSave).toHaveBeenCalledWith('Status', 'Done')
    expect(onStartEdit).toHaveBeenCalledWith(null)

    rerender(
      <SmartPropertyValueCell
        propKey="Tags"
        value={['alpha']}
        displayMode="tags"
        isEditing={true}
        vaultStatuses={[]}
        vaultTags={['alpha', 'beta']}
        onStartEdit={onStartEdit}
        onSave={onSave}
        onSaveList={onSaveList}
      />,
    )

    fireEvent.click(screen.getByTitle('Remove alpha'))
    fireEvent.click(screen.getByTestId('tags-add-button'))
    fireEvent.click(screen.getByTestId('tags-toggle'))
    fireEvent.click(screen.getByTestId('tags-close'))

    expect(onSaveList).toHaveBeenCalledWith('Tags', [])
    expect(onStartEdit).toHaveBeenCalledWith('Tags')
    expect(onSaveList).toHaveBeenCalledWith('Tags', ['alpha', 'beta'])
    expect(onStartEdit).toHaveBeenCalledWith(null)
  })

  it('covers number and date editing branches', () => {
    const onSave = vi.fn()
    const onSaveList = vi.fn()
    const onStartEdit = vi.fn()

    const { rerender } = render(
      <SmartPropertyValueCell
        propKey="Count"
        value="12"
        displayMode="number"
        isEditing={true}
        vaultStatuses={[]}
        vaultTags={[]}
        onStartEdit={onStartEdit}
        onSave={onSave}
        onSaveList={onSaveList}
      />,
    )

    fireEvent.change(screen.getByTestId('number-input'), { target: { value: '' } })
    fireEvent.blur(screen.getByTestId('number-input'))
    expect(onSave).toHaveBeenCalledWith('Count', '')

    rerender(
      <SmartPropertyValueCell
        propKey="Count"
        value="12"
        displayMode="number"
        isEditing={true}
        vaultStatuses={[]}
        vaultTags={[]}
        onStartEdit={onStartEdit}
        onSave={onSave}
        onSaveList={onSaveList}
      />,
    )

    fireEvent.change(screen.getByTestId('number-input'), { target: { value: '19' } })
    fireEvent.keyDown(screen.getByTestId('number-input'), { key: 'Enter' })
    expect(onSave).toHaveBeenCalledWith('Count', '19')

    rerender(
      <SmartPropertyValueCell
        propKey="Count"
        value="12"
        displayMode="number"
        isEditing={true}
        vaultStatuses={[]}
        vaultTags={[]}
        onStartEdit={onStartEdit}
        onSave={onSave}
        onSaveList={onSaveList}
      />,
    )

    fireEvent.change(screen.getByTestId('number-input'), { target: { value: 'nope' } })
    fireEvent.blur(screen.getByTestId('number-input'))
    expect(onStartEdit).toHaveBeenCalledWith(null)

    rerender(
      <AppPreferencesProvider dateDisplayFormat="european">
        <SmartPropertyValueCell
          propKey="Due"
          value="2026-04-20"
          displayMode="date"
          isEditing={true}
          vaultStatuses={[]}
          vaultTags={[]}
          onStartEdit={onStartEdit}
          onSave={onSave}
          onSaveList={onSaveList}
        />
      </AppPreferencesProvider>,
    )

    expect(screen.getByTestId('date-display')).toHaveTextContent('20/4/2026')
    expect(screen.getByTestId('date-picker-input')).toHaveValue('2026-04-20')
    fireEvent.click(screen.getByTestId('date-picker-calendar'))
    expect(onSave).toHaveBeenCalledWith('Due', '2026-04-22')

    rerender(
      <SmartPropertyValueCell
        propKey="Due"
        value="2026-04-20"
        displayMode="date"
        isEditing={true}
        vaultStatuses={[]}
        vaultTags={[]}
        onStartEdit={onStartEdit}
        onSave={onSave}
        onSaveList={onSaveList}
      />,
    )

    fireEvent.click(screen.getByTestId('date-picker-clear'))
    expect(onSave).toHaveBeenCalledWith('Due', '')
  })

  it('auto-detects scalar display modes and delegates array values correctly', () => {
    const onSave = vi.fn()
    const onSaveList = vi.fn()
    const onStartEdit = vi.fn()
    const onUpdate = vi.fn()

    const { rerender } = render(
      <SmartPropertyValueCell
        propKey="Flag"
        value={true}
        displayMode="text"
        isEditing={false}
        vaultStatuses={[]}
        vaultTags={[]}
        onStartEdit={onStartEdit}
        onSave={onSave}
        onSaveList={onSaveList}
        onUpdate={onUpdate}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox'))
    expect(onUpdate).toHaveBeenCalledWith('Flag', false)

    rerender(
      <SmartPropertyValueCell
        propKey="Website"
        value="https://example.com"
        displayMode="text"
        isEditing={false}
        vaultStatuses={[]}
        vaultTags={[]}
        onStartEdit={onStartEdit}
        onSave={onSave}
        onSaveList={onSaveList}
      />,
    )
    fireEvent.click(screen.getByTestId('url-value'))
    expect(onSave).toHaveBeenCalledWith('Website', 'https://saved.example')

    rerender(
      <SmartPropertyValueCell
        propKey="Accent"
        value="#ff0000"
        displayMode="text"
        isEditing={false}
        vaultStatuses={[]}
        vaultTags={[]}
        onStartEdit={onStartEdit}
        onSave={onSave}
        onSaveList={onSaveList}
      />,
    )
    fireEvent.click(screen.getByTestId('color-value'))
    expect(onSave).toHaveBeenCalledWith('Accent', '#00ff00')

    rerender(
      <SmartPropertyValueCell
        propKey="_icon"
        value="spark"
        displayMode="text"
        isEditing={false}
        vaultStatuses={[]}
        vaultTags={[]}
        onStartEdit={onStartEdit}
        onSave={onSave}
        onSaveList={onSaveList}
      />,
    )
    fireEvent.click(screen.getByTestId('icon-value'))
    expect(onSave).toHaveBeenCalledWith('_icon', 'sparkles')

    rerender(
      <SmartPropertyValueCell
        propKey="Labels"
        value={['alpha', 'beta']}
        displayMode="text"
        isEditing={false}
        vaultStatuses={[]}
        vaultTags={[]}
        onStartEdit={onStartEdit}
        onSave={onSave}
        onSaveList={onSaveList}
      />,
    )
    fireEvent.click(screen.getByTestId('tag-pill-list'))
    expect(onSaveList).toHaveBeenCalledWith('Labels', ['alpha', 'beta', 'gamma'])
  })
})
