import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { DisplayModeSelector, SmartPropertyValueCell } from './PropertyValueCells'

const { createValueButtonMock, calendarMockState } = vi.hoisted(() => ({
  createValueButtonMock:
    (testId: string, nextValue: (value: string) => string) =>
    ({ value, onSave }: { value: string; onSave: (value: string) => void }) => (
      <button data-testid={testId} onClick={() => onSave(nextValue(value))}>
        {value}
      </button>
    ),
  calendarMockState: {
    props: [] as Array<{
      captionLayout?: string
      navLayout?: string
      startMonth?: Date
      endMonth?: Date
    }>,
  },
}))

vi.mock('./EditableValue', () => ({
  EditableValue: createValueButtonMock('editable-value', (value) => `${value}-saved`),
  TagPillList: ({
    items,
    label,
    onSave,
  }: {
    items: string[]
    label: string
    onSave: (items: string[]) => void
  }) => (
    <button data-testid="tag-pill-list" onClick={() => onSave([...items, 'omega'])}>
      {label}:{items.join(',')}
    </button>
  ),
  UrlValue: createValueButtonMock('url-value', (value) => `${value}/updated`),
}))

vi.mock('./StatusDropdown', () => ({
  StatusDropdown: ({
    onSave,
    onCancel,
  }: {
    onSave: (value: string) => void
    onCancel: () => void
  }) => (
    <div>
      <button data-testid="status-save" onClick={() => onSave('Done')}>save</button>
      <button data-testid="status-cancel" onClick={onCancel}>cancel</button>
    </div>
  ),
}))

vi.mock('./TagsDropdown', () => ({
  TagsDropdown: ({
    onToggle,
    onClose,
  }: {
    onToggle: (tag: string) => void
    onClose: () => void
  }) => (
    <div data-testid="tags-dropdown">
      <button data-testid="tags-toggle-alpha" onClick={() => onToggle('alpha')}>alpha</button>
      <button data-testid="tags-toggle-beta" onClick={() => onToggle('beta')}>beta</button>
      <button data-testid="tags-close" onClick={onClose}>close</button>
    </div>
  ),
}))

vi.mock('./ColorInput', () => ({
  ColorEditableValue: createValueButtonMock('color-value', (value) => value.toUpperCase()),
}))

vi.mock('./IconEditableValue', () => ({
  IconEditableValue: createValueButtonMock('icon-value', (value) => `${value}-icon`),
}))

vi.mock('@/components/ui/calendar', () => ({
  Calendar: ({
    onSelect,
    captionLayout,
    navLayout,
    startMonth,
    endMonth,
  }: {
    onSelect: (value?: Date) => void
    captionLayout?: string
    navLayout?: string
    startMonth?: Date
    endMonth?: Date
  }) => {
    calendarMockState.props.push({ captionLayout, navLayout, startMonth, endMonth })
    return (
    <div>
      <button data-testid="date-picker-calendar" onClick={() => onSelect(new Date(2026, 3, 23))}>
        pick
      </button>
      <button data-testid="date-picker-empty" onClick={() => onSelect(undefined)}>
        empty
      </button>
    </div>
    )
  },
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: ({
    children,
    onOpenChange,
  }: {
    children: ReactNode
    onOpenChange?: (open: boolean) => void
  }) => (
    <div>
      {children}
      <button data-testid="popover-close" onClick={() => onOpenChange?.(false)}>close</button>
    </div>
  ),
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}))

function makeRect(right: number, bottom: number): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 24,
    height: 24,
    top: 0,
    left: 0,
    right,
    bottom,
    toJSON: () => ({}),
  } as DOMRect
}

describe('PropertyValueCells extra', () => {
  afterEach(() => {
    calendarMockState.props.length = 0
    vi.restoreAllMocks()
  })

  it('normalizes relationship property keys and positions the display-mode menu within the viewport', () => {
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(makeRect(100, 20))
    const onSelect = vi.fn()

    render(
      <DisplayModeSelector
        propKey=" Belongs-To "
        currentMode="text"
        autoMode="text"
        onSelect={onSelect}
      />,
    )

    fireEvent.click(screen.getByTestId('display-mode-trigger'))

    expect(screen.getByTestId('display-mode-icon-relationship')).toBeInTheDocument()
    expect(screen.getByTestId('display-mode-menu').style.left).toBe('8px')
    expect(screen.getByTestId('display-mode-menu').style.top).toBe('24px')

    const backdrop = Array.from(document.body.querySelectorAll('div')).find(
      (node) => node.className === 'fixed inset-0 z-[12000]',
    )
    fireEvent.click(backdrop as HTMLDivElement)
    expect(screen.queryByTestId('display-mode-menu')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('display-mode-trigger'))
    fireEvent.click(screen.getByTestId('display-mode-option-date'))

    expect(onSelect).toHaveBeenCalledWith(' Belongs-To ', 'date')
    rectSpy.mockRestore()
  })

  it('closes empty date pickers without saving and ignores undefined selections', () => {
    const onSave = vi.fn()
    const onStartEdit = vi.fn()

    render(
      <SmartPropertyValueCell
        propKey="Due"
        value=""
        displayMode="date"
        isEditing={true}
        vaultStatuses={[]}
        vaultTags={[]}
        onStartEdit={onStartEdit}
        onSave={onSave}
        onSaveList={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId('date-picker-empty'))
    fireEvent.click(screen.getByTestId('popover-close'))

    expect(onSave).not.toHaveBeenCalled()
    expect(onStartEdit).toHaveBeenCalledWith(null)
  })

  it('saves typed distant dates and enables dropdown calendar navigation', () => {
    const onSave = vi.fn()

    render(
      <SmartPropertyValueCell
        propKey="Due"
        value="2026-04-20"
        displayMode="date"
        isEditing={true}
        vaultStatuses={[]}
        vaultTags={[]}
        onStartEdit={vi.fn()}
        onSave={onSave}
        onSaveList={vi.fn()}
      />,
    )

    const input = screen.getByTestId('date-picker-input')
    fireEvent.change(input, { target: { value: '1884-02-29' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    const calendarProps = calendarMockState.props.at(-1)
    expect(onSave).toHaveBeenCalledWith('Due', '1884-02-29')
    expect(calendarProps?.captionLayout).toBe('dropdown')
    expect(calendarProps?.navLayout).toBe('after')
    expect(calendarProps?.startMonth?.getFullYear()).toBe(1800)
    expect(calendarProps?.endMonth?.getFullYear()).toBe(2200)
  })

  it('rejects invalid typed dates and cancels partial input on escape', () => {
    const onSave = vi.fn()
    const onStartEdit = vi.fn()

    render(
      <SmartPropertyValueCell
        propKey="Due"
        value="2026-04-20"
        displayMode="date"
        isEditing={true}
        vaultStatuses={[]}
        vaultTags={[]}
        onStartEdit={onStartEdit}
        onSave={onSave}
        onSaveList={vi.fn()}
      />,
    )

    const input = screen.getByTestId('date-picker-input')
    fireEvent.change(input, { target: { value: '2025-02-29' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSave).not.toHaveBeenCalled()
    expect(input).toHaveAttribute('aria-invalid', 'true')

    fireEvent.change(input, { target: { value: '1999-12' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onSave).not.toHaveBeenCalled()
    expect(onStartEdit).toHaveBeenCalledWith(null)
  })

  it('renders number displays, restores invalid input on escape, and falls back to editable text', () => {
    const onSave = vi.fn()
    const onStartEdit = vi.fn()

    const { rerender } = render(
      <SmartPropertyValueCell
        propKey="Count"
        value="12"
        displayMode="number"
        isEditing={false}
        vaultStatuses={[]}
        vaultTags={[]}
        onStartEdit={onStartEdit}
        onSave={onSave}
        onSaveList={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId('number-display'))
    expect(onStartEdit).toHaveBeenCalledWith('Count')

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
        onSaveList={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByTestId('number-input'), { target: { value: 'oops' } })
    fireEvent.keyDown(screen.getByTestId('number-input'), { key: 'Escape' })

    expect(onStartEdit).toHaveBeenCalledWith(null)

    rerender(
      <SmartPropertyValueCell
        propKey="Title"
        value="Plain text"
        displayMode="text"
        isEditing={false}
        vaultStatuses={[]}
        vaultTags={[]}
        onStartEdit={onStartEdit}
        onSave={onSave}
        onSaveList={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId('editable-value'))
    expect(onSave).toHaveBeenCalledWith('Title', 'Plain text-saved')
  })

  it('handles string booleans, tag toggles, and tag removals', () => {
    const onSaveList = vi.fn()
    const onStartEdit = vi.fn()
    const onUpdate = vi.fn()

    const { rerender } = render(
      <SmartPropertyValueCell
        propKey="Published"
        value="false"
        displayMode="boolean"
        isEditing={false}
        vaultStatuses={[]}
        vaultTags={[]}
        onStartEdit={onStartEdit}
        onSave={vi.fn()}
        onSaveList={onSaveList}
        onUpdate={onUpdate}
      />,
    )

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(false)

    fireEvent.click(checkbox)
    expect(onUpdate).toHaveBeenCalledWith('Published', true)

    rerender(
      <SmartPropertyValueCell
        propKey="Archived"
        value={0}
        displayMode="boolean"
        isEditing={false}
        vaultStatuses={[]}
        vaultTags={[]}
        onStartEdit={onStartEdit}
        onSave={vi.fn()}
        onSaveList={onSaveList}
        onUpdate={onUpdate}
      />,
    )

    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)

    rerender(
      <SmartPropertyValueCell
        propKey="Tags"
        value={['alpha']}
        displayMode="tags"
        isEditing={true}
        vaultStatuses={[]}
        vaultTags={['alpha', 'beta']}
        onStartEdit={onStartEdit}
        onSave={vi.fn()}
        onSaveList={onSaveList}
      />,
    )

    fireEvent.click(screen.getByTestId('tags-toggle-alpha'))
    fireEvent.click(screen.getByTitle('Remove alpha'))
    fireEvent.click(screen.getByTestId('tags-add-button'))
    fireEvent.click(screen.getByTestId('tags-toggle-beta'))

    expect(onSaveList).toHaveBeenCalledWith('Tags', [])
    expect(onStartEdit).toHaveBeenCalledWith('Tags')
    expect(onSaveList).toHaveBeenCalledWith('Tags', ['alpha', 'beta'])

    rerender(
      <SmartPropertyValueCell
        propKey="Category"
        value="solo"
        displayMode="tags"
        isEditing={true}
        vaultStatuses={[]}
        vaultTags={['solo', 'beta']}
        onStartEdit={onStartEdit}
        onSave={vi.fn()}
        onSaveList={onSaveList}
      />,
    )

    fireEvent.click(screen.getByTestId('tags-toggle-beta'))

    expect(onSaveList).toHaveBeenCalledWith('Category', ['solo', 'beta'])
  })
})
