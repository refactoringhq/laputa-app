import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { TypeCustomizePopover } from './TypeCustomizePopover'
import { resolveIcon, ICON_OPTIONS } from '../utils/iconRegistry'

describe('resolveIcon', () => {
  it('returns the correct icon component for known name', () => {
    const Icon = resolveIcon('wrench')
    expect(Icon).toBeDefined()
    // wrench should not be the default fallback (file-text)
    const fileTextIcon = resolveIcon('file-text')
    expect(Icon).not.toBe(fileTextIcon)
  })

  it('returns FileText fallback for null', () => {
    const Icon = resolveIcon(null)
    expect(Icon).toBeDefined()
  })

  it('returns FileText fallback for unknown name', () => {
    const Icon = resolveIcon('nonexistent-icon')
    expect(Icon).toBeDefined()
  })
})

describe('ICON_OPTIONS', () => {
  it('contains 200+ icons', () => {
    expect(ICON_OPTIONS.length).toBeGreaterThanOrEqual(200)
  })

  it('has unique names', () => {
    const names = ICON_OPTIONS.map((o) => o.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('uses kebab-case names', () => {
    for (const option of ICON_OPTIONS) {
      expect(option.name).toMatch(/^[a-z][a-z0-9-]*$/)
    }
  })
})

describe('TypeCustomizePopover', () => {
  const onChangeIcon = vi.fn()
  const onChangeColor = vi.fn()
  const onChangeTemplate = vi.fn()
  const onClose = vi.fn()

  const renderPopover = (overrides: Partial<Parameters<typeof TypeCustomizePopover>[0]> = {}) =>
    render(
      <TypeCustomizePopover
        currentIcon={null}
        currentColor={null}
        currentTemplate={null}
        onChangeIcon={onChangeIcon}
        onChangeColor={onChangeColor}
        onChangeTemplate={onChangeTemplate}
        onClose={onClose}
        {...overrides}
      />
    )

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders color, icon, and template sections', () => {
    renderPopover()
    expect(screen.getByText('Color')).toBeInTheDocument()
    expect(screen.getByText('Icon')).toBeInTheDocument()
    expect(screen.getByText('Template')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('can hide the template and Done controls for inline appearance editing', () => {
    renderPopover({ showTemplate: false, showDone: false, surface: 'inline' })
    expect(screen.getByText('Color')).toBeInTheDocument()
    expect(screen.getByText('Icon')).toBeInTheDocument()
    expect(screen.queryByText('Template')).not.toBeInTheDocument()
    expect(screen.queryByText('Done')).not.toBeInTheDocument()
  })

  it('renders search input', () => {
    renderPopover()
    expect(screen.getByPlaceholderText('Search icons…')).toBeInTheDocument()
  })

  it('filters icons by search query', () => {
    renderPopover()

    const searchInput = screen.getByPlaceholderText('Search icons…')
    fireEvent.change(searchInput, { target: { value: 'book' } })

    // Should show book-related icons
    expect(screen.getByTitle('book')).toBeInTheDocument()
    expect(screen.getByTitle('book-open')).toBeInTheDocument()
    // Should not show unrelated icons
    expect(screen.queryByTitle('wrench')).not.toBeInTheDocument()
  })

  it('shows empty state when no icons match search', () => {
    renderPopover()

    const searchInput = screen.getByPlaceholderText('Search icons…')
    fireEvent.change(searchInput, { target: { value: 'zzzznonexistent' } })

    expect(screen.getByText('No icons found')).toBeInTheDocument()
  })

  it('calls onChangeColor when a color is clicked', () => {
    renderPopover()

    const colorButtons = screen.getAllByTitle(/red|blue|green|purple|yellow|orange|teal|pink/i)
    fireEvent.click(colorButtons[0])

    expect(onChangeColor).toHaveBeenCalled()
  })

  it('calls onChangeIcon when an icon is clicked', () => {
    renderPopover()

    fireEvent.click(screen.getByTitle('wrench'))
    expect(onChangeIcon).toHaveBeenCalledWith('wrench')
  })

  it('calls onClose when Done is clicked', () => {
    renderPopover()

    fireEvent.click(screen.getByText('Done'))
    expect(onClose).toHaveBeenCalled()
  })

  it('renders all color options including teal and pink', () => {
    renderPopover()

    expect(screen.getByTitle('Teal')).toBeInTheDocument()
    expect(screen.getByTitle('Pink')).toBeInTheDocument()
  })

  // --- Template tests ---

  it('renders template textarea', () => {
    renderPopover()
    expect(screen.getByTestId('template-textarea')).toBeInTheDocument()
  })

  it('shows placeholder when template is empty', () => {
    renderPopover()
    expect(screen.getByPlaceholderText('Markdown template for new notes of this type…')).toBeInTheDocument()
  })

  it('displays current template value', () => {
    renderPopover({ currentTemplate: '## Objective\n\n## Notes' })
    const textarea = screen.getByTestId('template-textarea') as HTMLTextAreaElement
    expect(textarea.value).toBe('## Objective\n\n## Notes')
  })

  it('updates template text on user input', () => {
    renderPopover()
    const textarea = screen.getByTestId('template-textarea')
    fireEvent.change(textarea, { target: { value: '## New Template' } })
    expect((textarea as HTMLTextAreaElement).value).toBe('## New Template')
  })

  it('calls onChangeTemplate after debounce', async () => {
    vi.useFakeTimers()
    try {
      renderPopover()
      const textarea = screen.getByTestId('template-textarea')
      fireEvent.change(textarea, { target: { value: '## Debounced' } })

      // Should not be called immediately
      expect(onChangeTemplate).not.toHaveBeenCalled()

      // Fast-forward past debounce and flush the resulting state update.
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      expect(onChangeTemplate).toHaveBeenCalledWith('## Debounced')
    } finally {
      vi.useRealTimers()
    }
  })

  it('treats null template as empty string', () => {
    renderPopover({ currentTemplate: null })
    const textarea = screen.getByTestId('template-textarea') as HTMLTextAreaElement
    expect(textarea.value).toBe('')
  })
})
