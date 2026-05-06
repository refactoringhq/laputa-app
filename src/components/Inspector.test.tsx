import type { ComponentProps, ReactElement } from 'react'
import { render as rtlRender, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Inspector } from './Inspector'
import type { VaultEntry, GitCommit } from '../types'
import { TooltipProvider } from '@/components/ui/tooltip'

function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: TooltipProvider })
}

const mockEntry: VaultEntry = {
  path: '/vault/project/test.md',
  filename: 'test.md',
  title: 'Test Project',
  isA: 'Project',
  aliases: [],
  belongsTo: ['[[responsibility/grow-newsletter]]'],
  relatedTo: ['[[topic/software-development]]'],
  status: 'Active',
  owner: 'Luca Rossi',
  cadence: null,
  archived: false,
  modifiedAt: 1707900000,
  createdAt: null,
  fileSize: 1024,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
    order: null,
  template: null, sort: null,
  outgoingLinks: [],
}

const mockContent = `---
title: Test Project
is_a: Project
Status: Active
Owner: Luca Rossi
Cadence: Weekly
tags: [React, TypeScript, Tauri]
Belongs to:
  - "[[responsibility/grow-newsletter]]"
Related to:
  - "[[topic/software-development]]"
---

# Test Project

This is a test note with some words to count.
`

const referrerEntry: VaultEntry = {
  path: '/vault/note/referrer.md',
  filename: 'referrer.md',
  title: 'Referrer Note',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: null,
  owner: null,
  cadence: null,
  archived: false,
  modifiedAt: 1707900000,
  createdAt: null,
  fileSize: 200,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  template: null, sort: null,
  outgoingLinks: ['Test Project'],
}

const now = Math.floor(Date.now() / 1000)
const mockGitHistory: GitCommit[] = [
  { hash: 'a1b2c3d4e5f6a7b8', shortHash: 'a1b2c3d', message: 'Update test with latest changes', author: 'Luca Rossi', date: now - 86400 * 2 },
  { hash: 'e4f5g6h7i8j9k0l1', shortHash: 'e4f5g6h', message: 'Add new section to test', author: 'Luca Rossi', date: now - 86400 * 5 },
  { hash: 'i7j8k9l0m1n2o3p4', shortHash: 'i7j8k9l', message: 'Create test', author: 'Luca Rossi', date: now - 86400 * 12 },
]

const defaultProps = {
  collapsed: false,
  onToggle: () => {},
  entry: null as VaultEntry | null,
  content: null as string | null,
  entries: [] as VaultEntry[],
  gitHistory: [] as GitCommit[],
  onNavigate: () => {},
}

type InspectorProps = ComponentProps<typeof Inspector>

function renderInspector(overrides: Partial<InspectorProps> = {}) {
  return render(<Inspector {...defaultProps} {...overrides} />)
}

function renderSelectedInspector(overrides: Partial<InspectorProps> = {}) {
  return renderInspector({
    entry: mockEntry,
    content: mockContent,
    ...overrides,
  })
}

describe('Inspector', () => {
  it('renders expanded state with "no note selected"', () => {
    render(<Inspector {...defaultProps} />)
    // Header now says "Properties" (not "Inspector")
    expect(screen.getAllByText('Properties').length).toBeGreaterThan(0)
    expect(screen.getByTestId('properties-panel-icon')).toBeInTheDocument()
    expect(screen.getByText('No note selected')).toBeInTheDocument()
  })

  it('renders collapsed state without sections', () => {
    render(<Inspector {...defaultProps} collapsed={true} />)
    // When collapsed, no section content is visible
    expect(screen.queryByText('No note selected')).not.toBeInTheDocument()
  })

  it('calls onToggle when the close button is clicked', () => {
    const onToggle = vi.fn()
    render(<Inspector {...defaultProps} onToggle={onToggle} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Close Properties (⌘⇧I)' })[1])
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('closes when the properties sidebar icon is clicked', () => {
    const onToggle = vi.fn()
    render(<Inspector {...defaultProps} onToggle={onToggle} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Close Properties (⌘⇧I)' })[0])

    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('shows a colliding-properties warning that opens the raw editor', async () => {
    const onToggleRawEditor = vi.fn()
    const content = `---
type: Note
status: Active
Status: Evergreened
---
# Test Project
`

    renderSelectedInspector({ content, onToggleRawEditor })

    const warning = screen.getByRole('button', { name: 'Colliding properties. Open raw editor.' })
    fireEvent.focus(warning)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Colliding properties')

    fireEvent.click(warning)
    expect(onToggleRawEditor).toHaveBeenCalledOnce()
  })

  it('shows properties when a note is selected', () => {
    render(<Inspector {...defaultProps} entry={mockEntry} content={mockContent} />)
    expect(screen.getAllByText('Project').length).toBeGreaterThan(0)
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Type')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Words')).toBeInTheDocument()
  })

  it('renders status as a colored badge with dot indicator', () => {
    render(<Inspector {...defaultProps} entry={mockEntry} content={mockContent} />)
    const badge = screen.getByTestId('status-badge')
    expect(badge).toHaveTextContent('Active')
    expect(badge.style.borderRadius).toBe('6px')
  })

  it('computes word count from content minus frontmatter and title', () => {
    render(<Inspector {...defaultProps} entry={mockEntry} content={mockContent} />)
    // Title "# Test Project" excluded; body: "This is a test note with some words to count." = 10 words
    expect(screen.getByText('10')).toBeInTheDocument()
  })

  it('shows "Add property" button as disabled placeholder', () => {
    render(<Inspector {...defaultProps} entry={mockEntry} content={mockContent} />)
    const btn = screen.getByRole('button', { name: 'Add property' })
    expect(btn).toBeDisabled()
  })

  it('shows cadence when present', () => {
    // Cadence is now read from frontmatter in content (already in mockContent)
    render(<Inspector {...defaultProps} entry={mockEntry} content={mockContent} />)
    expect(screen.getByText('Cadence')).toBeInTheDocument()
    expect(screen.getByText('Weekly')).toBeInTheDocument()
  })

  it('shows a separator between properties and relationships', () => {
    render(<Inspector {...defaultProps} entry={mockEntry} content={mockContent} />)
    expect(screen.getByTestId('inspector-properties-relationships-separator')).toBeInTheDocument()
  })

  it('shows relationships with clickable links', () => {
    render(<Inspector {...defaultProps} entry={mockEntry} content={mockContent} />)
    expect(screen.getByText('Belongs to')).toBeInTheDocument()
    expect(screen.getByText('Grow Newsletter')).toBeInTheDocument()
    expect(screen.getByText('Related to')).toBeInTheDocument()
    expect(screen.getByText('Software Development')).toBeInTheDocument()
  })

  it('navigates when a relationship link is clicked', () => {
    const onNavigate = vi.fn()
    render(<Inspector {...defaultProps} entry={mockEntry} content={mockContent} onNavigate={onNavigate} />)
    fireEvent.click(screen.getByText('Grow Newsletter'))
    expect(onNavigate).toHaveBeenCalledWith('responsibility/grow-newsletter')
  })

  it('hides relationships label when entry has no belongsTo/relatedTo', () => {
    const noRels = { ...mockEntry, belongsTo: [], relatedTo: [] }
    const contentNoRels = `---
title: Test Project
is_a: Project
Status: Active
---

# Test Project

This is a test note with some words to count.
`
    render(<Inspector {...defaultProps} entry={noRels} content={contentNoRels} />)
    expect(screen.queryByText('No relationships')).not.toBeInTheDocument()
  })

  it('shows backlinks from notes that reference the current note via outgoingLinks', () => {
    render(
      <Inspector
        {...defaultProps}
        entry={mockEntry}
        content={mockContent}
        entries={[mockEntry, referrerEntry]}
      />
    )
    expect(screen.getByText('Backlinks')).toBeInTheDocument()
    expect(screen.getByText('Referrer Note')).toBeInTheDocument()
  })

  it('updates backlinks reactively when outgoingLinks changes', () => {
    const { rerender } = render(
      <Inspector
        {...defaultProps}
        entry={mockEntry}
        content={mockContent}
        entries={[mockEntry, { ...referrerEntry, outgoingLinks: [] }]}
      />
    )
    expect(screen.queryByText('Backlinks')).not.toBeInTheDocument()

    rerender(
      <Inspector
        {...defaultProps}
        entry={mockEntry}
        content={mockContent}
        entries={[mockEntry, { ...referrerEntry, outgoingLinks: ['Test Project'] }]}
      />
    )
    expect(screen.getByText('Backlinks')).toBeInTheDocument()
    expect(screen.getByText('Referrer Note')).toBeInTheDocument()
  })

  it('hides backlinks section when no notes reference the current note', () => {
    renderSelectedInspector({ entries: [mockEntry] })
    expect(screen.queryByText('Backlinks')).not.toBeInTheDocument()
  })

  it('navigates when a backlink is clicked', () => {
    const onNavigate = vi.fn()
    renderSelectedInspector({
      entries: [mockEntry, referrerEntry],
      onNavigate,
    })
    fireEvent.click(screen.getByText('Referrer Note'))
    expect(onNavigate).toHaveBeenCalledWith('Referrer Note')
  })

  it('shows git history with commit hashes and messages', () => {
    renderSelectedInspector({ gitHistory: mockGitHistory })
    expect(screen.getByText('History')).toBeInTheDocument()
    expect(screen.getByText('a1b2c3d')).toBeInTheDocument()
    expect(screen.getByText('e4f5g6h')).toBeInTheDocument()
    expect(screen.getByText('i7j8k9l')).toBeInTheDocument()
  })

  it('renders commit entries as clickable buttons', () => {
    const onViewCommitDiff = vi.fn()
    renderSelectedInspector({
      gitHistory: mockGitHistory,
      onViewCommitDiff,
    })
    const hashBtn = screen.getByText('a1b2c3d')
    const button = hashBtn.closest('button')!
    expect(button.tagName).toBe('BUTTON')
    button.click()
    expect(onViewCommitDiff).toHaveBeenCalledWith('a1b2c3d4e5f6a7b8')
  })

  it('hides history section when no commits', () => {
    renderSelectedInspector({ gitHistory: [] })
    expect(screen.queryByText('History')).not.toBeInTheDocument()
  })

  it('shows separate Info section with read-only metadata', () => {
    renderSelectedInspector()
    expect(screen.getByText('Info')).toBeInTheDocument()
    expect(screen.getByText('Modified')).toBeInTheDocument()
    expect(screen.getByText('Created')).toBeInTheDocument()
    expect(screen.getByText('Size')).toBeInTheDocument()
  })

  it('renders editable properties with interactive styling', () => {
    render(
      <Inspector
        {...defaultProps}
        entry={mockEntry}
        content={mockContent}
      />
    )
    const editableRows = screen.getAllByTestId('editable-property')
    expect(editableRows.length).toBeGreaterThan(0)
    editableRows.forEach(row => {
      expect(row.className).toContain('hover:bg-muted')
    })
  })

  it('renders read-only properties with muted non-interactive styling', () => {
    render(
      <Inspector
        {...defaultProps}
        entry={mockEntry}
        content={mockContent}
      />
    )
    const readOnlyRows = screen.getAllByTestId('readonly-property')
    expect(readOnlyRows.length).toBe(4) // Modified, Created, Words, Size
    readOnlyRows.forEach(row => {
      expect(row.className).not.toContain('hover:bg-muted')
      expect(row.className).not.toContain('cursor-pointer')
    })
  })

  describe('Referenced By (bidirectional relationships)', () => {
    const targetEntry: VaultEntry = {
      path: '/Users/luca/Laputa/responsibility/grow-newsletter.md',
      filename: 'grow-newsletter.md',
      title: 'Grow Newsletter',
      isA: 'Responsibility',
      aliases: [],
      belongsTo: [],
      relatedTo: [],
      status: 'Active',
      owner: null,
      cadence: null,
      archived: false,
      modifiedAt: 1707900000,
      createdAt: null,
      fileSize: 500,
      snippet: '',
      wordCount: 0,
      relationships: { 'Type': ['[[responsibility]]'] },
      icon: null,
      color: null,
      order: null,
      template: null, sort: null,
      outgoingLinks: [],
    }

    const essayEntry: VaultEntry = {
      path: '/Users/luca/Laputa/essay/on-writing.md',
      filename: 'on-writing.md',
      title: 'On Writing Well',
      isA: 'Essay',
      aliases: [],
      belongsTo: ['[[responsibility/grow-newsletter]]'],
      relatedTo: [],
      status: null,
      owner: null,
      cadence: null,
      archived: false,
      modifiedAt: 1707900000,
      createdAt: null,
      fileSize: 300,
      snippet: '',
      wordCount: 0,
      relationships: { 'Belongs to': ['[[responsibility/grow-newsletter]]'], 'Type': ['[[essay]]'] },
      icon: null,
      color: null,
      order: null,
      template: null, sort: null,
      outgoingLinks: [],
    }

    const procedureEntry: VaultEntry = {
      path: '/Users/luca/Laputa/procedure/write-essays.md',
      filename: 'write-essays.md',
      title: 'Write Weekly Essays',
      isA: 'Procedure',
      aliases: [],
      belongsTo: ['[[responsibility/grow-newsletter]]'],
      relatedTo: [],
      status: null,
      owner: null,
      cadence: null,
      archived: false,
      modifiedAt: 1707900000,
      createdAt: null,
      fileSize: 400,
      snippet: '',
      wordCount: 0,
      relationships: { 'Belongs to': ['[[responsibility/grow-newsletter]]'], 'Type': ['[[procedure]]'] },
      icon: null,
      color: null,
      order: null,
      template: null, sort: null,
      outgoingLinks: [],
    }

    const experimentEntry: VaultEntry = {
      path: '/Users/luca/Laputa/experiment/seo.md',
      filename: 'seo.md',
      title: 'SEO Experiment',
      isA: 'Experiment',
      aliases: [],
      belongsTo: [],
      relatedTo: ['[[responsibility/grow-newsletter]]'],
      status: null,
      owner: null,
      cadence: null,
      archived: false,
      modifiedAt: 1707900000,
      createdAt: null,
      fileSize: 200,
      snippet: '',
      wordCount: 0,
      relationships: { 'Related to': ['[[responsibility/grow-newsletter]]'], 'Type': ['[[experiment]]'] },
      icon: null,
      color: null,
      order: null,
      template: null, sort: null,
      outgoingLinks: [],
    }

    const targetContent = `---
title: Grow Newsletter
is_a: Responsibility
Status: Active
---

# Grow Newsletter
`

    it('shows entries that reference the current note via frontmatter relationships', () => {
      render(
        <Inspector
          {...defaultProps}
          entry={targetEntry}
          content={targetContent}
          entries={[targetEntry, essayEntry, procedureEntry, experimentEntry]}

        />
      )
      expect(screen.getByText('On Writing Well')).toBeInTheDocument()
      expect(screen.getByText('Write Weekly Essays')).toBeInTheDocument()
      expect(screen.getByText('SEO Experiment')).toBeInTheDocument()
    })

    it('groups referenced-by entries by relationship key', () => {
      render(
        <Inspector
          {...defaultProps}
          entry={targetEntry}
          content={targetContent}
          entries={[targetEntry, essayEntry, experimentEntry]}

        />
      )
      expect(screen.getByText('Children')).toBeInTheDocument()
      expect(screen.getByText('Referenced by')).toBeInTheDocument()
    })

    it('hides referenced-by section when no entries reference the current note', () => {
      renderInspector({
        entry: targetEntry,
        content: targetContent,
        entries: [targetEntry],
      })
      expect(screen.queryByText('No references')).not.toBeInTheDocument()
      expect(screen.queryByText('Referenced by')).not.toBeInTheDocument()
    })

    it('navigates when clicking a referenced-by entry', () => {
      const onNavigate = vi.fn()
      renderInspector({
        entry: targetEntry,
        content: targetContent,
        entries: [targetEntry, essayEntry],
        onNavigate,
      })
      fireEvent.click(screen.getByText('On Writing Well'))
      expect(onNavigate).toHaveBeenCalledWith('On Writing Well')
    })

    it('skips Type relationships in referenced-by computation', () => {
      const typeEntry: VaultEntry = {
        ...targetEntry,
        path: '/Users/luca/Laputa/responsibility.md',
        filename: 'responsibility.md',
        title: 'Responsibility',
        isA: 'Type',
        relationships: {},
      }
      // essayEntry has Type: [[responsibility]] — should NOT show as referenced-by
      render(
        <Inspector
          {...defaultProps}
          entry={typeEntry}
          content="---\ntype: Type\n---\n# Responsibility\n"
          entries={[typeEntry, essayEntry]}

        />
      )
      // On Writing Well references responsibility via "Belongs to" (path match), not via "Type"
      // But the Type entry is at responsibility.md, so wikilinks to
      // responsibility/grow-newsletter won't match. Section should be hidden
      expect(screen.queryByText('Referenced by')).not.toBeInTheDocument()
    })

    it('resolves references via aliased wikilinks', () => {
      const aliasedTarget: VaultEntry = {
        ...targetEntry,
        aliases: ['Newsletter'],
      }
      const referrer: VaultEntry = {
        ...essayEntry,
        relationships: { 'Topics': ['[[Newsletter]]'], 'Type': ['[[essay]]'] },
      }
      render(
        <Inspector
          {...defaultProps}
          entry={aliasedTarget}
          content={targetContent}
          entries={[aliasedTarget, referrer]}

        />
      )
      expect(screen.getByText('On Writing Well')).toBeInTheDocument()
      expect(screen.getByText(/← Topics/i)).toBeInTheDocument()
    })

    it('excludes entries from backlinks when already shown in referenced-by', () => {
      const noteA: VaultEntry = {
        path: '/Users/luca/Laputa/essay/on-writing.md',
        filename: 'on-writing.md',
        title: 'On Writing Well',
        isA: 'Essay',
        aliases: [],
        belongsTo: ['[[responsibility/grow-newsletter]]'],
        relatedTo: [],
        status: null,
        owner: null,
        cadence: null,
        archived: false,
        modifiedAt: 1707900000,
        createdAt: null,
        fileSize: 300,
        snippet: '',
        wordCount: 0,
        relationships: { 'Belongs to': ['[[responsibility/grow-newsletter]]'], 'Type': ['[[essay]]'] },
        icon: null,
        color: null,
        order: null,
        template: null, sort: null,
        // Body text also links to grow-newsletter
        outgoingLinks: ['responsibility/grow-newsletter'],
      }
      render(
        <Inspector
          {...defaultProps}
          entry={targetEntry}
          content={targetContent}
          entries={[targetEntry, noteA]}
        />
      )
      // noteA shows in Referenced By (via Belongs to)
      expect(screen.getByText('Children')).toBeInTheDocument()
      expect(screen.getByText('On Writing Well')).toBeInTheDocument()
      // But NOT in Backlinks (even though outgoingLinks matches) — section hidden
      expect(screen.queryByTestId('backlinks-toggle')).not.toBeInTheDocument()
    })

    it('does not show self-references', () => {
      const selfRef: VaultEntry = {
        ...targetEntry,
        relationships: {
          ...targetEntry.relationships,
          'Notes': ['[[responsibility/grow-newsletter]]'],
        },
      }
      render(
        <Inspector
          {...defaultProps}
          entry={selfRef}
          content={targetContent}
          entries={[selfRef]}

        />
      )
      expect(screen.queryByText('Referenced by')).not.toBeInTheDocument()
    })
  })

  describe('frontmatter state handling', () => {
    const noFrontmatterEntry: VaultEntry = {
      ...mockEntry,
      path: '/vault/plain-note.md',
      filename: 'plain-note.md',
      title: 'plain-note',
      isA: null,
    }

    it('shows "Initialize properties" button when note has no frontmatter', () => {
      render(
        <Inspector
          {...defaultProps}
          entry={noFrontmatterEntry}
          content="# Just a plain note\n\nNo frontmatter here."
          onInitializeProperties={vi.fn()}
        />
      )
      expect(screen.getByText('Initialize properties')).toBeInTheDocument()
      expect(screen.queryByText('Type')).not.toBeInTheDocument()
    })

    it('shows "Initialize properties" button when frontmatter is empty', () => {
      render(
        <Inspector
          {...defaultProps}
          entry={noFrontmatterEntry}
          content="---\n---\n# Note with empty frontmatter"
          onInitializeProperties={vi.fn()}
        />
      )
      expect(screen.getByText('Initialize properties')).toBeInTheDocument()
    })

    it('calls onInitializeProperties when button is clicked', () => {
      const onInit = vi.fn()
      render(
        <Inspector
          {...defaultProps}
          entry={noFrontmatterEntry}
          content="# Plain note"
          onInitializeProperties={onInit}
        />
      )
      fireEvent.click(screen.getByText('Initialize properties'))
      expect(onInit).toHaveBeenCalledWith('/vault/plain-note.md')
    })

    it('does not offer frontmatter initialization for binary attachments', () => {
      const onInit = vi.fn()
      const attachmentEntry: VaultEntry = {
        ...noFrontmatterEntry,
        path: '/vault/attachments/screenshot.png',
        filename: 'screenshot.png',
        title: 'screenshot.png',
        fileKind: 'binary',
      }

      render(
        <Inspector
          {...defaultProps}
          entry={attachmentEntry}
          content=""
          onInitializeProperties={onInit}
        />
      )

      expect(screen.queryByText('Initialize properties')).not.toBeInTheDocument()
      expect(onInit).not.toHaveBeenCalled()
    })

    it('shows invalid frontmatter notice with fix button', () => {
      render(
        <Inspector
          {...defaultProps}
          entry={noFrontmatterEntry}
          content={'---\n{broken yaml\n---\nBody'}
          onToggleRawEditor={vi.fn()}
        />
      )
      expect(screen.getByText('Invalid properties')).toBeInTheDocument()
      expect(screen.getByText('Fix in editor')).toBeInTheDocument()
    })

    it('calls onToggleRawEditor when fix button is clicked', () => {
      const onToggle = vi.fn()
      render(
        <Inspector
          {...defaultProps}
          entry={noFrontmatterEntry}
          content={'---\n{broken yaml\n---\nBody'}
          onToggleRawEditor={onToggle}
        />
      )
      fireEvent.click(screen.getByText('Fix in editor'))
      expect(onToggle).toHaveBeenCalledOnce()
    })

    it('still shows backlinks and history for notes without frontmatter', () => {
      render(
        <Inspector
          {...defaultProps}
          entry={noFrontmatterEntry}
          content="# Plain note"
          entries={[noFrontmatterEntry, { ...referrerEntry, outgoingLinks: ['plain-note'] }]}
          gitHistory={mockGitHistory}
          onInitializeProperties={vi.fn()}
        />
      )
      expect(screen.getByText('Initialize properties')).toBeInTheDocument()
      expect(screen.getByText('Backlinks')).toBeInTheDocument()
      expect(screen.getByText('History')).toBeInTheDocument()
    })
  })
})
