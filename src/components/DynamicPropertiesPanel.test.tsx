import type { ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { DynamicPropertiesPanel, containsWikilinks } from './DynamicPropertiesPanel'
import type { VaultEntry } from '../types'
import { bindVaultConfigStore, getVaultConfig, resetVaultConfigStore } from '../utils/vaultConfigStore'
import { initDisplayModeOverrides } from '../utils/propertyTypes'
import { TooltipProvider } from '@/components/ui/tooltip'

// Radix Select needs ResizeObserver and pointer/scroll APIs in JSDOM
beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  // Radix Popover needs getComputedStyle in JSDOM
  if (!window.getComputedStyle) window.getComputedStyle = vi.fn().mockReturnValue({}) as never
})

const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: '/vault/note/test.md',
  filename: 'test.md',
  title: 'Test Note',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: 'Active',
  owner: null,
  cadence: null,
  archived: false,
  modifiedAt: 1700000000,
  createdAt: 1700000000,
  fileSize: 100,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  template: null, sort: null,
  outgoingLinks: [],
  ...overrides,
})

type DynamicPropertiesPanelProps = ComponentProps<typeof DynamicPropertiesPanel>
type RenderPanelOptions = Omit<DynamicPropertiesPanelProps, 'entry' | 'content' | 'frontmatter'> & {
  entry?: VaultEntry
  content?: string
  frontmatter?: Record<string, unknown>
}

const renderPanel = ({
  entry = makeEntry(),
  content = '',
  frontmatter = {},
  ...props
}: RenderPanelOptions = {}) =>
  render(
    <TooltipProvider>
      <DynamicPropertiesPanel
        entry={entry}
        content={content}
        frontmatter={frontmatter}
        {...props}
      />
    </TooltipProvider>,
  )

describe('containsWikilinks', () => {
  it('returns true for string wikilinks', () => {
    expect(containsWikilinks('[[My Note]]')).toBe(true)
  })

  it('returns false for non-wikilink strings', () => {
    expect(containsWikilinks('plain text')).toBe(false)
  })

  it('returns true for arrays containing wikilinks', () => {
    expect(containsWikilinks(['[[Note1]]', '[[Note2]]'])).toBe(true)
  })

  it('returns false for arrays without wikilinks', () => {
    expect(containsWikilinks(['tag1', 'tag2'])).toBe(false)
  })

  it('returns false for booleans', () => {
    expect(containsWikilinks(true)).toBe(false)
  })

  it('returns false for null', () => {
    expect(containsWikilinks(null)).toBe(false)
  })
})

describe('DynamicPropertiesPanel', () => {
  const onUpdateProperty = vi.fn()
  const onDeleteProperty = vi.fn()
  const onAddProperty = vi.fn()
  const onNavigate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function renderEditablePanel(frontmatter: Record<string, unknown>) {
    renderPanel({ frontmatter, onUpdateProperty })
  }

  function openAddPropertyForm(options: RenderPanelOptions = {}) {
    renderPanel({ onAddProperty, ...options })
    fireEvent.click(screen.getByText('Add property'))

    return {
      keyInput: screen.getByPlaceholderText('Property name'),
      valueInput: screen.getByPlaceholderText('Value'),
    }
  }

  it('renders type row', () => {
    renderPanel({
      content: '# Test\n\nSome words here',
      frontmatter: { Status: 'Active' },
      onUpdateProperty,
    })
    expect(screen.getByText('Type')).toBeInTheDocument()
    expect(screen.getByText('Note')).toBeInTheDocument()
  })

  it('shows the shared type icon in the type row label', () => {
    renderPanel({
      content: '# Test\n\nSome words here',
      frontmatter: { Status: 'Active' },
      onUpdateProperty,
    })

    expect(screen.getByTestId('type-row-icon')).toBeInTheDocument()
  })

  it('renders status as colored pill', () => {
    renderPanel({ frontmatter: { Status: 'Active' } })
    // Status rendered as sentence case
    expect(screen.getByTestId('status-badge')).toBeInTheDocument()
  })

  it('renders properties from frontmatter', () => {
    renderPanel({ frontmatter: { cadence: 'Weekly', owner: 'Luca' } })
    expect(screen.getByText('Cadence')).toBeInTheDocument()
    expect(screen.getByText('Weekly')).toBeInTheDocument()
    expect(screen.getByText('Owner')).toBeInTheDocument()
    expect(screen.getByText('Luca')).toBeInTheDocument()
  })

  it('renders capitalized Owner with plain text value in Properties panel', () => {
    renderPanel({ frontmatter: { Owner: 'Luca' } })
    expect(screen.getByText('Owner')).toBeInTheDocument()
    expect(screen.getByText('Luca')).toBeInTheDocument()
  })

  it('left-aligns mixed property value displays', () => {
    renderPanel({
      frontmatter: {
        Owner: 'Luca',
        History_confidence: 0.84,
        Date: '2026-04-11',
        color: '#3b82f6',
        Window_end: null,
      },
    })

    expect(screen.getByText('Luca').parentElement).toHaveClass('justify-start', 'text-left')
    expect(screen.getByText('0.84').parentElement).toHaveClass('justify-start', 'text-left')
    expect(screen.getByTestId('date-display')).toHaveClass('text-left')
    expect(screen.getByText('#3b82f6')).toHaveClass('text-left')
    expect(screen.getByText('\u2014').parentElement).toHaveClass('justify-start', 'text-left')
  })

  it('hides Owner with wikilink value from Properties panel', () => {
    renderPanel({ frontmatter: { Owner: '[[person/luca]]' } })
    // Owner with wikilink goes to RelationshipsPanel, not Properties
    expect(screen.queryByText('Owner')).not.toBeInTheDocument()
  })

  it('renders notion_id as a visible property', () => {
    renderPanel({ frontmatter: { notion_id: 'abc-123-def' } })
    expect(screen.getByText('Notion id')).toBeInTheDocument()
    expect(screen.getByText('abc-123-def')).toBeInTheDocument()
  })

  it('skips aliases and fields with wikilink values', () => {
    renderPanel({
      frontmatter: { aliases: ['AL'], 'Belongs to': '[[Something]]', cadence: 'Monthly' },
    })
    // aliases skipped (in SKIP_KEYS); 'Belongs to' skipped (has wikilinks)
    expect(screen.queryByText('aliases')).not.toBeInTheDocument()
    expect(screen.queryByText('Belongs to')).not.toBeInTheDocument()
    expect(screen.getByText('Cadence')).toBeInTheDocument()
  })

  it('shows former relationship key with plain text value in Properties', () => {
    renderPanel({ frontmatter: { 'Belongs to': 'some-team', cadence: 'Monthly' } })
    // 'Belongs to' has a plain text value, not a wikilink — should render as property
    expect(screen.getByText('Belongs to')).toBeInTheDocument()
    expect(screen.getByText('some-team')).toBeInTheDocument()
  })

  it('localizes UI actions without translating stored property names', () => {
    renderPanel({
      frontmatter: { Status: 'Active', 'Belongs to': 'some-team' },
      onAddProperty,
      locale: 'zh-CN',
    })

    expect(screen.getByText('Type')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Belongs to')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加属性' })).toBeInTheDocument()
  })

  it('hides custom field with wikilink value from Properties', () => {
    renderPanel({ frontmatter: { Mentor: '[[person/luca]]' } })
    // Mentor contains a wikilink → shown in Relationships, not Properties
    expect(screen.queryByText('Mentor')).not.toBeInTheDocument()
  })

  it('skips is_a, Is A, and type keys (shown via TypeRow instead)', () => {
    renderPanel({
      frontmatter: { is_a: 'Note', type: 'Note', 'Is A': 'Note', Status: 'Active' },
    })
    expect(screen.queryByText('is_a')).not.toBeInTheDocument()
    expect(screen.queryByText('Is A')).not.toBeInTheDocument()
    // 'type' as a property label should not appear (the TypeRow renders 'Type' differently)
    const typeLabels = screen.getAllByText('Type')
    // Only the TypeRow label should exist, not a property row
    expect(typeLabels).toHaveLength(1)
    expect(screen.getByTestId('status-badge')).toBeInTheDocument()
  })

  it('renders boolean property as toggle', () => {
    renderEditablePanel({ published: false })
    // Boolean should show as Yes/No toggle
    const toggleBtn = screen.getByText('No')
    fireEvent.click(toggleBtn)
    expect(onUpdateProperty).toHaveBeenCalledWith('published', true)
  })

  it('renders array property as tag pills', () => {
    renderEditablePanel({ tags: ['ai', 'ml', 'deep-learning'] })
    expect(screen.getByText('ai')).toBeInTheDocument()
    expect(screen.getByText('ml')).toBeInTheDocument()
    expect(screen.getByText('deep-learning')).toBeInTheDocument()
  })

  it('shows Add property button', () => {
    renderPanel({ onAddProperty })
    expect(screen.getByText('Add property')).toBeInTheDocument()
  })

  it('opens add property form when button clicked', () => {
    const { keyInput, valueInput } = openAddPropertyForm()
    expect(keyInput).toBeInTheDocument()
    expect(valueInput).toBeInTheDocument()
    expect(screen.getByTestId('add-property-type-trigger')).toBeInTheDocument()
  })

  it('adds property via the add form', () => {
    const { keyInput, valueInput } = openAddPropertyForm()
    fireEvent.change(keyInput, { target: { value: 'priority' } })
    fireEvent.change(valueInput, { target: { value: 'high' } })
    fireEvent.click(screen.getByTestId('add-property-confirm'))
    expect(onAddProperty).toHaveBeenCalledWith('priority', 'high')
  })

  it('handles navigating to type via click in read-only mode', () => {
    render(
      <TooltipProvider>
        <DynamicPropertiesPanel
          entry={makeEntry({ isA: 'Project' })}
          content=""
          frontmatter={{}}
          onNavigate={onNavigate}
        />
      </TooltipProvider>,
    )
    fireEvent.click(screen.getByText('Project'))
    expect(onNavigate).toHaveBeenCalledWith('project')
  })

  describe('TypeSelector', () => {
    const typeEntries = [
      makeEntry({ path: '/vault/project.md', title: 'Project', isA: 'Type' }),
      makeEntry({ path: '/vault/person.md', title: 'Person', isA: 'Type' }),
      makeEntry({ path: '/vault/topic.md', title: 'Topic', isA: 'Type' }),
    ]

    it('renders as dropdown when editable', () => {
      renderPanel({ entries: typeEntries, onUpdateProperty })
      expect(screen.getByTestId('type-selector')).toBeInTheDocument()
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })

    it('shows available types in dropdown', () => {
      renderPanel({ entries: typeEntries, onUpdateProperty })
      fireEvent.pointerDown(screen.getByRole('combobox'), { button: 0, pointerType: 'mouse' })
      expect(screen.getByRole('option', { name: 'None' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Person' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Project' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Topic' })).toBeInTheDocument()
    })

    function openAndSelect(optionName: string) {
      fireEvent.pointerDown(screen.getByRole('combobox'), { button: 0, pointerType: 'mouse' })
      fireEvent.click(screen.getByRole('option', { name: optionName }))
    }

    it('calls onUpdateProperty when type selected', () => {
      renderPanel({ entries: typeEntries, onUpdateProperty })
      openAndSelect('Project')
      expect(onUpdateProperty).toHaveBeenCalledWith('type', 'Project')
    })

    it('clears type when None selected', () => {
      renderPanel({
        entry: makeEntry({ isA: 'Project' }),
        entries: typeEntries,
        onUpdateProperty,
      })
      openAndSelect('None')
      expect(onUpdateProperty).toHaveBeenCalledWith('type', null)
    })

    it('shows current type even when not in available types', () => {
      renderPanel({
        entry: makeEntry({ isA: 'CustomType' }),
        entries: typeEntries,
        onUpdateProperty,
      })
      fireEvent.pointerDown(screen.getByRole('combobox'), { button: 0, pointerType: 'mouse' })
      expect(screen.getByRole('option', { name: 'CustomType' })).toBeInTheDocument()
    })

    it('shows a missing-type warning with keyboard-accessible help and creation flow', async () => {
      const onCreateMissingType = vi.fn().mockResolvedValue(undefined)

      renderPanel({
        entry: makeEntry({ isA: 'Hotel' }),
        entries: typeEntries,
        onUpdateProperty,
        onCreateMissingType,
      })

      const warningButton = screen.getByTestId('missing-type-warning')
      expect(warningButton).toBeInTheDocument()

      fireEvent.focus(warningButton)
      await waitFor(() => {
        expect(screen.getByRole('tooltip')).toHaveTextContent('Missing type')
      })

      fireEvent.click(warningButton)
      expect(screen.getByDisplayValue('Hotel')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Create' }))
      await waitFor(() => expect(onCreateMissingType).toHaveBeenCalledWith('Hotel'))
    })

    it('does not show a missing-type warning when the type already exists', () => {
      renderPanel({
        entry: makeEntry({ isA: 'Project' }),
        entries: typeEntries,
        onUpdateProperty,
      })

      expect(screen.queryByTestId('missing-type-warning')).not.toBeInTheDocument()
    })

    it('shows None placeholder when entry has no type', () => {
      renderPanel({
        entry: makeEntry({ isA: null }),
        entries: typeEntries,
        onUpdateProperty,
      })
      expect(screen.getByTestId('type-selector')).toBeInTheDocument()
      expect(screen.getByText('None')).toBeInTheDocument()
    })
  })

  it('opens status dropdown on click and selects a status', () => {
    renderEditablePanel({ Status: 'Active' })
    // Click status pill to open dropdown
    fireEvent.click(screen.getByTestId('status-badge'))
    // Should show dropdown with search input
    expect(screen.getByTestId('status-dropdown')).toBeInTheDocument()
    expect(screen.getByTestId('status-search-input')).toBeInTheDocument()
    // Click on "Done" option in the suggested list
    fireEvent.click(screen.getByTestId('status-option-Done'))
    expect(onUpdateProperty).toHaveBeenCalledWith('Status', 'Done')
  })

  it('deletes property when delete button clicked', () => {
    renderPanel({
      frontmatter: { custom_field: 'value' },
      onDeleteProperty,
      onUpdateProperty,
    })
    const deleteBtn = screen.getByTitle('Delete property')
    fireEvent.click(deleteBtn)
    expect(onDeleteProperty).toHaveBeenCalledWith('custom_field')
  })

  it('coerces true/false strings to booleans on save', () => {
    renderEditablePanel({ draft: 'false' })
    // Edit the value
    fireEvent.click(screen.getByText('false'))
    const input = screen.getByDisplayValue('false')
    fireEvent.change(input, { target: { value: 'true' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onUpdateProperty).toHaveBeenCalledWith('draft', true)
  })

  it('coerces numeric strings to numbers on save', () => {
    renderEditablePanel({ priority: '3' })
    fireEvent.click(screen.getByText('3'))
    const input = screen.getByDisplayValue('3')
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onUpdateProperty).toHaveBeenCalledWith('priority', 5)
  })

  it('cancels add form on Escape', () => {
    const { keyInput } = openAddPropertyForm()
    fireEvent.keyDown(keyInput, { key: 'Escape' })
    // Form should be hidden, button should reappear
    expect(screen.getByText('Add property')).toBeInTheDocument()
  })

  it('adds property on Enter in form', () => {
    const { keyInput, valueInput } = openAddPropertyForm()
    fireEvent.change(keyInput, { target: { value: 'key' } })
    fireEvent.change(valueInput, { target: { value: 'val' } })
    fireEvent.keyDown(valueInput, { key: 'Enter' })
    expect(onAddProperty).toHaveBeenCalledWith('key', 'val')
  })

  it('handles comma-separated values as array', () => {
    const { keyInput, valueInput } = openAddPropertyForm()
    fireEvent.change(keyInput, { target: { value: 'tags' } })
    fireEvent.change(valueInput, { target: { value: 'a, b, c' } })
    fireEvent.keyDown(valueInput, { key: 'Enter' })
    expect(onAddProperty).toHaveBeenCalledWith('tags', ['a', 'b', 'c'])
  })

  it('handles cancel button in add form', () => {
    openAddPropertyForm()
    fireEvent.click(screen.getByTestId('add-property-cancel'))
    expect(screen.getByText('Add property')).toBeInTheDocument()
  })

  describe('editable vs read-only distinction', () => {
    it('editable properties have hover styling via data-testid', () => {
      renderPanel({
        frontmatter: { cadence: 'Weekly', owner: 'Luca' },
        onUpdateProperty,
        onDeleteProperty,
      })
      const editableRows = screen.getAllByTestId('editable-property')
      expect(editableRows.length).toBe(2)
      // Editable rows have hover:bg-muted class for interactivity
      editableRows.forEach(row => {
        expect(row.className).toContain('hover:bg-muted')
      })
    })
  })

  describe('property row 50/50 layout', () => {
    it('uses CSS grid with two equal columns on editable rows', () => {
      renderEditablePanel({ url: 'https://example.com/very/long/path/that/should/be/truncated' })
      const editableRows = screen.getAllByTestId('editable-property')
      editableRows.forEach(row => {
        expect(row.className).toContain('grid')
        expect(row.className).toContain('grid-cols-2')
      })
    })
  })

  describe('suggested property slots', () => {
    function findSuggestedSlot(label: string): HTMLElement {
      const slot = screen.getAllByTestId('suggested-property').find((node) => node.textContent?.includes(label))
      expect(slot).toBeDefined()
      return slot as HTMLElement
    }

    it('shows Status/Date/URL/Icon slots when no properties exist and onAddProperty provided', () => {
      renderPanel({ onAddProperty })
      const slots = screen.getAllByTestId('suggested-property')
      expect(slots.length).toBe(4)
      expect(screen.getByText('Status')).toBeInTheDocument()
      expect(screen.getByText('Date')).toBeInTheDocument()
      expect(screen.getByText('URL')).toBeInTheDocument()
      expect(screen.getByText('Icon')).toBeInTheDocument()
    })

    it('shows a property-kind icon for each suggested slot', () => {
      renderPanel({ onAddProperty })

      expect(within(findSuggestedSlot('Status')).getByTestId('suggested-property-icon-status')).toBeInTheDocument()
      expect(within(findSuggestedSlot('Date')).getByTestId('suggested-property-icon-date')).toBeInTheDocument()
      expect(within(findSuggestedSlot('URL')).getByTestId('suggested-property-icon-url')).toBeInTheDocument()
      expect(within(findSuggestedSlot('Icon')).getByTestId('suggested-property-icon-text')).toBeInTheDocument()
    })

    it('hides Status slot when Status property already exists', () => {
      renderPanel({
        frontmatter: { Status: 'Active' },
        onAddProperty,
        onUpdateProperty,
      })
      const slots = screen.getAllByTestId('suggested-property')
      expect(slots.length).toBe(3)
      expect(screen.queryAllByText('Status').some(el => el.closest('[data-testid="suggested-property"]'))).toBe(false)
    })

    it('hides all slots when all suggested properties exist', () => {
      renderPanel({
        frontmatter: { Status: 'Active', Date: '2024-01-01', URL: 'https://example.com', icon: 'star' },
        onAddProperty,
        onUpdateProperty,
      })
      expect(screen.queryByTestId('suggested-property')).not.toBeInTheDocument()
    })

    it('does not show slots when onAddProperty is not provided', () => {
      renderPanel()
      expect(screen.queryByTestId('suggested-property')).not.toBeInTheDocument()
    })

    it('opens the status editor without writing an empty property when clicking a suggested slot', async () => {
      renderPanel({ onAddProperty })
      fireEvent.click(findSuggestedSlot('Status'))
      expect(onAddProperty).not.toHaveBeenCalled()
      await waitFor(() => {
        expect(document.querySelector('[data-testid="status-dropdown-popover"]')).toBeInTheDocument()
      })
    })

    it('writes the suggested status only after the user picks a value', async () => {
      renderPanel({ onAddProperty, onUpdateProperty })
      fireEvent.click(findSuggestedSlot('Status'))

      await waitFor(() => {
        expect(document.querySelector('[data-testid="status-option-Active"]')).toBeInTheDocument()
      })
      fireEvent.click(document.querySelector('[data-testid="status-option-Active"]') as Element)

      expect(onAddProperty).toHaveBeenCalledWith('Status', 'Active')
    })

    it('cancels a suggested status edit without writing frontmatter', async () => {
      renderPanel({ onAddProperty })
      fireEvent.click(findSuggestedSlot('Status'))

      await waitFor(() => {
        expect(document.querySelector('[data-testid="status-search-input"]')).toBeInTheDocument()
      })
      fireEvent.keyDown(document.querySelector('[data-testid="status-search-input"]') as Element, { key: 'Escape' })

      expect(onAddProperty).not.toHaveBeenCalled()
      expect(findSuggestedSlot('Status')).toBeInTheDocument()
    })

    it('opens the date picker without writing an empty property when clicking the Date slot', async () => {
      renderPanel({ onAddProperty })
      fireEvent.click(findSuggestedSlot('Date'))

      expect(onAddProperty).not.toHaveBeenCalled()
      await waitFor(() => {
        expect(screen.getByTestId('date-picker-popover')).toBeInTheDocument()
      })
    })
  })

  describe('URL property rendering', () => {
    it('renders URL values with link styling instead of plain EditableValue', () => {
      renderEditablePanel({ url: 'https://example.com' })
      expect(screen.getByTestId('url-link')).toBeInTheDocument()
      expect(screen.getByTestId('url-link')).toHaveTextContent('https://example.com')
    })

    it('gives long URL values a truncating value-cell layout inside the properties panel', () => {
      renderEditablePanel({ url: 'https://example.com/very/long/path/that/should/truncate' })

      const link = screen.getByTestId('url-link')
      const value = screen.getByText('https://example.com/very/long/path/that/should/truncate')
      expect(link).toHaveClass('flex-1', 'overflow-hidden')
      expect(value).toHaveClass('truncate')
    })

    it('renders bare domain values as URL links', () => {
      renderEditablePanel({ website: 'example.com' })
      expect(screen.getByTestId('url-link')).toBeInTheDocument()
    })

    it('does not render plain text as URL link', () => {
      renderEditablePanel({ cadence: 'Weekly' })
      expect(screen.queryByTestId('url-link')).not.toBeInTheDocument()
    })

    it('shows edit button on URL property', () => {
      renderEditablePanel({ url: 'https://example.com' })
      expect(screen.getByTestId('url-edit-btn')).toBeInTheDocument()
    })

    it('enters edit mode when edit button clicked on URL property', () => {
      renderEditablePanel({ url: 'https://example.com' })
      fireEvent.click(screen.getByTestId('url-edit-btn'))
      expect(screen.getByDisplayValue('https://example.com')).toBeInTheDocument()
    })
  })

  describe('smart property display — date', () => {
    it('renders date property with friendly format', () => {
      renderEditablePanel({ deadline: '2026-03-31' })
      expect(screen.getByTestId('date-display')).toBeInTheDocument()
      expect(screen.getByText('Mar 31, 2026')).toBeInTheDocument()
    })

    it('renders date trigger button', () => {
      renderEditablePanel({ deadline: '2026-03-31' })
      const trigger = screen.getByTestId('date-display')
      expect(trigger.tagName).toBe('BUTTON')
    })

    it('opens calendar popover when date button clicked', () => {
      renderEditablePanel({ deadline: '2026-03-31' })
      fireEvent.click(screen.getByTestId('date-display'))
      expect(screen.getByTestId('date-picker-popover')).toBeInTheDocument()
      // Clear button is inside the popover portal
      expect(screen.getByText('Clear date')).toBeInTheDocument()
    })
  })

  describe('smart property display — number', () => {
    it('renders numeric properties with the number display affordance', () => {
      renderEditablePanel({ estimate: -3.25 })
      expect(screen.getByTestId('number-display')).toBeInTheDocument()
      expect(screen.getByText('-3.25')).toBeInTheDocument()
    })
  })

  describe('smart property display — status auto-detection', () => {
    it('renders status badge for property named Status', () => {
      renderEditablePanel({ Status: 'Active' })
      expect(screen.getByTestId('status-badge')).toBeInTheDocument()
    })

    it('renders status badge for known status values', () => {
      renderEditablePanel({ phase: 'Draft' })
      expect(screen.getByTestId('status-badge')).toBeInTheDocument()
    })
  })

  describe('status dropdown interaction', () => {
    it('closes dropdown on Escape without saving', () => {
      renderEditablePanel({ Status: 'Active' })
      fireEvent.click(screen.getByTestId('status-badge'))
      expect(screen.getByTestId('status-dropdown')).toBeInTheDocument()
      fireEvent.keyDown(screen.getByTestId('status-search-input'), { key: 'Escape' })
      expect(screen.queryByTestId('status-dropdown')).not.toBeInTheDocument()
      expect(onUpdateProperty).not.toHaveBeenCalled()
    })

    it('closes dropdown on backdrop click without saving', () => {
      renderEditablePanel({ Status: 'Active' })
      fireEvent.click(screen.getByTestId('status-badge'))
      fireEvent.click(screen.getByTestId('status-dropdown-backdrop'))
      expect(screen.queryByTestId('status-dropdown')).not.toBeInTheDocument()
      expect(onUpdateProperty).not.toHaveBeenCalled()
    })

    it('creates custom status by typing and pressing Enter', () => {
      renderEditablePanel({ Status: 'Active' })
      fireEvent.click(screen.getByTestId('status-badge'))
      const input = screen.getByTestId('status-search-input')
      fireEvent.change(input, { target: { value: 'Needs Review' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onUpdateProperty).toHaveBeenCalledWith('Status', 'Needs Review')
    })

    it('shows vault statuses from entries', () => {
      const entriesWithStatuses = [
        makeEntry({ path: '/vault/a.md', status: 'Reviewing' }),
        makeEntry({ path: '/vault/b.md', status: 'Shipped' }),
      ]
      renderPanel({
        frontmatter: { Status: 'Active' },
        entries: entriesWithStatuses,
        onUpdateProperty,
      })
      fireEvent.click(screen.getByTestId('status-badge'))
      expect(screen.getByTestId('status-option-Reviewing')).toBeInTheDocument()
      expect(screen.getByTestId('status-option-Shipped')).toBeInTheDocument()
    })
  })

  describe('smart property display — boolean', () => {
    it('renders boolean toggle for true values', () => {
      renderEditablePanel({ published: true })
      expect(screen.getByTestId('boolean-toggle')).toBeInTheDocument()
      expect(screen.getByText('Yes')).toBeInTheDocument()
    })

    it('renders boolean toggle for false values', () => {
      renderEditablePanel({ published: false })
      expect(screen.getByTestId('boolean-toggle')).toBeInTheDocument()
      expect(screen.getByText('No')).toBeInTheDocument()
    })
  })

  describe('system property filtering', () => {
    it('hides archived metadata but keeps the note icon visible in the properties panel', () => {
      renderEditablePanel({ archived: false, archived_at: '', icon: '📝', cadence: 'Weekly' })
      expect(screen.queryByText('Archived')).not.toBeInTheDocument()
      expect(screen.queryByText('Archived at')).not.toBeInTheDocument()
      expect(screen.getByText('Icon')).toBeInTheDocument()
      expect(screen.getByText('📝')).toBeInTheDocument()
      expect(screen.getByText('Cadence')).toBeInTheDocument()
    })

    it('keeps the note icon visible even when cased differently', () => {
      renderEditablePanel({ Archived: false, Icon: '🎯', cadence: 'Daily' })
      expect(screen.queryByText('Archived')).not.toBeInTheDocument()
      expect(screen.getByText('Icon')).toBeInTheDocument()
      expect(screen.getByText('🎯')).toBeInTheDocument()
      expect(screen.getByText('Cadence')).toBeInTheDocument()
    })

    it('does not filter similar but non-matching property names', () => {
      renderEditablePanel({ 'Is Trashed': true, archive_date: '2026-01-01' })
      expect(screen.getByText('Is Trashed')).toBeInTheDocument()
      expect(screen.getByText('Archive date')).toBeInTheDocument()
    })
  })

  describe('display mode override', () => {
    beforeEach(() => {
      resetVaultConfigStore()
      bindVaultConfigStore(
        { zoom: null, view_mode: null, editor_mode: null, tag_colors: null, status_colors: null, property_display_modes: null },
        vi.fn(),
      )
      initDisplayModeOverrides({})
    })

    it('renders display mode trigger on property rows', () => {
      renderEditablePanel({ cadence: 'Weekly' })
      expect(screen.getByTestId('display-mode-trigger')).toBeInTheDocument()
    })

    it('opens display mode menu on trigger click', () => {
      renderEditablePanel({ cadence: 'Weekly' })
      fireEvent.click(screen.getByTestId('display-mode-trigger'))
      expect(screen.getByTestId('display-mode-menu')).toBeInTheDocument()
      expect(screen.getByTestId('display-mode-option-text')).toBeInTheDocument()
      expect(screen.getByTestId('display-mode-option-number')).toBeInTheDocument()
      expect(screen.getByTestId('display-mode-option-date')).toBeInTheDocument()
      expect(screen.getByTestId('display-mode-option-boolean')).toBeInTheDocument()
      expect(screen.getByTestId('display-mode-option-status')).toBeInTheDocument()
      expect(screen.getByTestId('display-mode-option-url')).toBeInTheDocument()
    })

    it('persists override to vault config when mode selected', () => {
      renderEditablePanel({ cadence: 'Weekly' })
      fireEvent.click(screen.getByTestId('display-mode-trigger'))
      fireEvent.click(screen.getByTestId('display-mode-option-status'))
      const stored = getVaultConfig().property_display_modes as Record<string, string>
      expect(stored).toBeTruthy()
      expect(stored.cadence).toBe('status')
    })

    it('overrides rendering to status badge when status mode selected', () => {
      initDisplayModeOverrides({ cadence: 'status' })
      renderEditablePanel({ cadence: 'Weekly' })
      expect(screen.getByTestId('status-badge')).toBeInTheDocument()
    })

    it('renders boolean toggle for string "true" when boolean mode overridden', () => {
      initDisplayModeOverrides({ draft: 'boolean' })
      renderEditablePanel({ draft: 'true' })
      expect(screen.getByTestId('boolean-toggle')).toBeInTheDocument()
      expect(screen.getByText('Yes')).toBeInTheDocument()
    })

    it('renders boolean toggle for string "false" when boolean mode overridden', () => {
      initDisplayModeOverrides({ draft: 'boolean' })
      renderEditablePanel({ draft: 'false' })
      expect(screen.getByTestId('boolean-toggle')).toBeInTheDocument()
      expect(screen.getByText('No')).toBeInTheDocument()
    })

    it('toggles string boolean from false to true', () => {
      initDisplayModeOverrides({ draft: 'boolean' })
      renderEditablePanel({ draft: 'false' })
      fireEvent.click(screen.getByTestId('boolean-toggle'))
      expect(onUpdateProperty).toHaveBeenCalledWith('draft', true)
    })

    it('renders date picker for empty value when date mode overridden', () => {
      initDisplayModeOverrides({ due: 'date' })
      renderEditablePanel({ due: '' })
      expect(screen.getByTestId('date-display')).toBeInTheDocument()
      expect(screen.getByText('Pick a date\u2026')).toBeInTheDocument()
    })

    it('renders date picker for non-date string when date mode overridden', () => {
      initDisplayModeOverrides({ deadline: 'date' })
      renderEditablePanel({ deadline: 'soon' })
      expect(screen.getByTestId('date-display')).toBeInTheDocument()
    })
  })

  describe('type-aware add property form', () => {
    it('shows number input when number type selected', () => {
      openAddPropertyForm()
      fireEvent.pointerDown(screen.getByTestId('add-property-type-trigger'), { button: 0, pointerType: 'mouse' })
      fireEvent.click(screen.getByRole('option', { name: /Number/ }))
      expect(screen.getByTestId('add-property-number-input')).toBeInTheDocument()
    })

    it('shows boolean toggle when boolean type selected', () => {
      openAddPropertyForm()
      // Switch type to boolean
      fireEvent.pointerDown(screen.getByTestId('add-property-type-trigger'), { button: 0, pointerType: 'mouse' })
      fireEvent.click(screen.getByRole('option', { name: /Boolean/ }))
      expect(screen.getByTestId('add-property-boolean-toggle')).toBeInTheDocument()
      expect(screen.getByText('\u2717 No')).toBeInTheDocument()
    })

    it('toggles boolean value in add form', () => {
      openAddPropertyForm()
      fireEvent.pointerDown(screen.getByTestId('add-property-type-trigger'), { button: 0, pointerType: 'mouse' })
      fireEvent.click(screen.getByRole('option', { name: /Boolean/ }))
      // Toggle from No to Yes
      fireEvent.click(screen.getByTestId('add-property-boolean-toggle'))
      expect(screen.getByText('\u2713 Yes')).toBeInTheDocument()
    })

    it('stores actual boolean value when adding boolean property', { timeout: 15_000 }, () => {
      const { keyInput } = openAddPropertyForm()
      fireEvent.change(keyInput, { target: { value: 'published' } })
      // Switch to boolean type
      fireEvent.pointerDown(screen.getByTestId('add-property-type-trigger'), { button: 0, pointerType: 'mouse' })
      fireEvent.click(screen.getByRole('option', { name: /Boolean/ }))
      // Default is false, toggle to true
      fireEvent.click(screen.getByTestId('add-property-boolean-toggle'))
      // Submit
      fireEvent.click(screen.getByTestId('add-property-confirm'))
      expect(onAddProperty).toHaveBeenCalledWith('published', true)
    })

    it('stores trimmed decimal values as numbers when adding number properties', () => {
      const { keyInput } = openAddPropertyForm()
      fireEvent.change(keyInput, { target: { value: 'estimate' } })
      fireEvent.pointerDown(screen.getByTestId('add-property-type-trigger'), { button: 0, pointerType: 'mouse' })
      fireEvent.click(screen.getByRole('option', { name: /Number/ }))
      fireEvent.change(screen.getByTestId('add-property-number-input'), { target: { value: ' -12.5 ' } })
      fireEvent.click(screen.getByTestId('add-property-confirm'))
      expect(onAddProperty).toHaveBeenCalledWith('estimate', -12.5)
    })

    it('shows date picker trigger when date type selected', { timeout: 15_000 }, () => {
      openAddPropertyForm()
      fireEvent.pointerDown(screen.getByTestId('add-property-type-trigger'), { button: 0, pointerType: 'mouse' })
      fireEvent.click(screen.getByRole('option', { name: /Date/ }))
      expect(screen.getByTestId('add-property-date-trigger')).toBeInTheDocument()
      expect(screen.getByText('Pick a date\u2026')).toBeInTheDocument()
    })

    it('shows status dropdown when status type selected', { timeout: 15_000 }, () => {
      openAddPropertyForm()
      fireEvent.pointerDown(screen.getByTestId('add-property-type-trigger'), { button: 0, pointerType: 'mouse' })
      fireEvent.click(screen.getByRole('option', { name: /Status/ }))
      expect(screen.getByTestId('add-property-status-trigger')).toBeInTheDocument()
    })

    it('shows text input for text and url types', () => {
      openAddPropertyForm()
      // Default mode is text
      expect(screen.getByPlaceholderText('Value')).toBeInTheDocument()
    })
  })
})
