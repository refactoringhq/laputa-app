import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PulseView } from './PulseView'
import type { PulseCommit } from '../types'

const openExternalUrl = vi.fn()
const mockCommits: PulseCommit[] = [
  {
    hash: 'abc123def456',
    shortHash: 'abc123d',
    message: 'Update project notes',
    date: Math.floor(Date.now() / 1000) - 3600,
    githubUrl: 'https://github.com/owner/repo/commit/abc123def456',
    files: [
      { path: 'project/my-project.md', status: 'modified', title: 'my project' },
      { path: 'note/new-note.md', status: 'added', title: 'new note' },
    ],
    added: 1,
    modified: 1,
    deleted: 0,
  },
  {
    hash: 'def456abc789',
    shortHash: 'def456a',
    message: 'Remove old notes',
    date: Math.floor(Date.now() / 1000) - 86400,
    githubUrl: null,
    files: [
      { path: 'note/old.md', status: 'deleted', title: 'old' },
    ],
    added: 0,
    modified: 0,
    deleted: 1,
  },
]

const mockInvokeFn = vi.fn()
const dragRegionMouseDown = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvokeFn(...args),
}))
vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: (...args: unknown[]) => mockInvokeFn(...args),
}))
vi.mock('../hooks/useDragRegion', () => ({
  useDragRegion: () => ({ onMouseDown: dragRegionMouseDown }),
}))
vi.mock('../utils/url', () => ({
  openExternalUrl: (...args: unknown[]) => openExternalUrl(...args),
}))

describe('PulseView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dragRegionMouseDown.mockClear()
  })

  it('shows loading state initially', () => {
    mockInvokeFn.mockReturnValue(new Promise(() => {})) // never resolves
    render(<PulseView vaultPath="/test/vault" />)
    expect(screen.getByText('Loading activity…')).toBeInTheDocument()
  })

  it('renders commits grouped by day', async () => {
    mockInvokeFn.mockResolvedValue(mockCommits)

    render(<PulseView vaultPath="/test/vault" />)

    await waitFor(() => {
      expect(screen.getByText('Update project notes')).toBeInTheDocument()
    })

    expect(screen.getByText('Remove old notes')).toBeInTheDocument()
  })

  it('shows summary badges for added/modified/deleted', async () => {
    mockInvokeFn.mockResolvedValue(mockCommits)

    render(<PulseView vaultPath="/test/vault" />)

    await waitFor(() => {
      expect(screen.getByText('+1')).toBeInTheDocument()
    })
    expect(screen.getByText('~1')).toBeInTheDocument()
    expect(screen.getByText('-1')).toBeInTheDocument()
  })

  it('shows commit hashes', async () => {
    mockInvokeFn.mockResolvedValue(mockCommits)

    render(<PulseView vaultPath="/test/vault" />)

    await waitFor(() => {
      expect(screen.getByText('abc123d')).toBeInTheDocument()
    })
    expect(screen.getByText('def456a')).toBeInTheDocument()
  })

  it('renders GitHub links for commits with githubUrl', async () => {
    mockInvokeFn.mockResolvedValue(mockCommits)

    render(<PulseView vaultPath="/test/vault" />)

    await waitFor(() => {
      const link = screen.getByText('abc123d')
      expect(link.tagName).toBe('A')
      expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/commit/abc123def456')
    })

    // Non-GitHub commit should be a span
    const nonLink = screen.getByText('def456a')
    expect(nonLink.tagName).toBe('SPAN')
  })

  it('opens commit links through the shared external URL opener', async () => {
    mockInvokeFn.mockResolvedValue(mockCommits)

    render(<PulseView vaultPath="/test/vault" />)

    const link = await screen.findByText('abc123d')
    fireEvent.click(link)

    expect(openExternalUrl).toHaveBeenCalledWith('https://github.com/owner/repo/commit/abc123def456')
  })

  it('renders file list with correct titles when expanded', async () => {
    mockInvokeFn.mockResolvedValue(mockCommits)

    render(<PulseView vaultPath="/test/vault" />)

    // Files are collapsed by default — expand all commit cards first
    await waitFor(() => {
      expect(screen.getAllByLabelText('Expand files').length).toBeGreaterThan(0)
    })
    screen.getAllByLabelText('Expand files').forEach((btn) => fireEvent.click(btn))

    await waitFor(() => {
      expect(screen.getByText('my project')).toBeInTheDocument()
    })
    expect(screen.getByText('new note')).toBeInTheDocument()
    expect(screen.getByText('old')).toBeInTheDocument()
  })

  it.each([
    {
      label: 'a non-deleted file',
      rowLabels: ['Update project notes'],
      fileText: 'my project',
      expected: ['project/my-project.md', 'abc123def456'],
    },
    {
      label: 'a deleted file to open commit diff',
      rowLabels: ['Update project notes', 'Remove old notes'],
      fileText: 'old',
      expected: ['note/old.md', 'def456abc789'],
    },
  ])('calls onOpenNote when clicking $label', async ({ rowLabels, fileText, expected }) => {
    mockInvokeFn.mockResolvedValue(mockCommits)
    const onOpenNote = vi.fn()

    render(<PulseView vaultPath="/test/vault" onOpenNote={onOpenNote} />)

    await waitFor(() => {
      expect(screen.getAllByLabelText('Expand files').length).toBeGreaterThan(0)
    })
    rowLabels.forEach((rowLabel) => fireEvent.click(screen.getByText(rowLabel)))

    await waitFor(() => {
      expect(screen.getByText(fileText)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText(fileText))
    expect(onOpenNote).toHaveBeenCalledWith(...expected)
  })

  it('shows empty state when no commits', async () => {
    mockInvokeFn.mockResolvedValue([])

    render(<PulseView vaultPath="/test/vault" />)

    await waitFor(() => {
      expect(screen.getByText('No activity yet')).toBeInTheDocument()
    })
  })

  it('shows error state and retry button', async () => {
    mockInvokeFn.mockRejectedValue('Not a git repository')

    render(<PulseView vaultPath="/test/vault" />)

    await waitFor(() => {
      expect(screen.getByText('Not a git repository')).toBeInTheDocument()
    })
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it('calls get_vault_pulse with skip=0 on initial load and passes correct page size', async () => {
    mockInvokeFn.mockResolvedValue([])

    render(<PulseView vaultPath="/test/vault" />)

    await waitFor(() => {
      expect(mockInvokeFn).toHaveBeenCalledWith('get_vault_pulse', { vaultPath: '/test/vault', limit: 20, skip: 0 })
    })
  })

  it('calls get_vault_pulse with correct arguments', async () => {
    mockInvokeFn.mockResolvedValue([])

    render(<PulseView vaultPath="/my/vault" />)

    await waitFor(() => {
      expect(mockInvokeFn).toHaveBeenCalledWith('get_vault_pulse', { vaultPath: '/my/vault', limit: 20, skip: 0 })
    })
  })

  it('toggles file list visibility when clicking anywhere on the commit row', async () => {
    mockInvokeFn.mockResolvedValue(mockCommits)

    render(<PulseView vaultPath="/test/vault" />)

    // Files are collapsed by default
    await waitFor(() => {
      expect(screen.getAllByLabelText('Expand files').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText('my project')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Update project notes'))

    await waitFor(() => {
      expect(screen.getByText('my project')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Update project notes'))

    expect(screen.queryByText('my project')).not.toBeInTheDocument()
  })

  it('uses a full-width surface for hover, focus, and expanded commit rows', async () => {
    mockInvokeFn.mockResolvedValue(mockCommits)

    render(<PulseView vaultPath="/test/vault" />)

    const commitRow = await screen.findByRole('button', { name: /Update project notes/i })
    const hasExpandedBackground = (className: string) => /(^|\s)bg-accent\/40(\s|$)/.test(className)

    expect(commitRow.className).toContain('-mx-4')
    expect(commitRow.className).toContain('px-4')
    expect(commitRow.className).toContain('rounded-none')
    expect(commitRow.className).toContain('hover:bg-accent/40')
    expect(commitRow.className).toContain('focus-visible:bg-accent/40')
    expect(hasExpandedBackground(commitRow.className)).toBe(false)

    fireEvent.click(commitRow)

    expect(hasExpandedBackground(commitRow.className)).toBe(true)
  })

  it('supports keyboard activation for commit rows and file rows', async () => {
    mockInvokeFn.mockResolvedValue(mockCommits)
    const onOpenNote = vi.fn()

    render(<PulseView vaultPath="/test/vault" onOpenNote={onOpenNote} />)

    const commitRow = await screen.findByRole('button', { name: /Update project notes/i })
    commitRow.focus()
    fireEvent.keyDown(commitRow, { key: 'Enter' })

    const fileButton = await screen.findByRole('button', { name: 'my project' })
    fileButton.focus()
    fireEvent.keyDown(fileButton, { key: 'Enter' })

    expect(onOpenNote).toHaveBeenCalledWith('project/my-project.md', 'abc123def456')
  })

  it('renders History header', async () => {
    mockInvokeFn.mockResolvedValue([])

    render(<PulseView vaultPath="/test/vault" />)

    await waitFor(() => {
      expect(screen.getByText('History')).toBeInTheDocument()
    })
  })

  it('shows a repository selector in the History header when multiple repositories are available', async () => {
    mockInvokeFn.mockResolvedValue([])

    render(
      <PulseView
        vaultPath="/work"
        repositories={[
          { path: '/default', label: 'Default', defaultForNewNotes: true },
          { path: '/work', label: 'Work', defaultForNewNotes: false },
        ]}
        selectedRepositoryPath="/work"
        onRepositoryChange={vi.fn()}
      />,
    )

    expect(await screen.findByTestId('pulse-repository-select')).toBeInTheDocument()
    expect(screen.getByText('Work')).toBeInTheDocument()
  })

  it('wires the Pulse header into the shared drag-region handler', async () => {
    mockInvokeFn.mockResolvedValue([])

    render(<PulseView vaultPath="/test/vault" />)

    const header = await screen.findByTestId('pulse-header')
    fireEvent.mouseDown(header)

    expect(dragRegionMouseDown).toHaveBeenCalledTimes(1)
  })

  it('keeps the expand-sidebar button clickable when the header is draggable', async () => {
    mockInvokeFn.mockResolvedValue([])
    const onExpandSidebar = vi.fn()

    render(
      <PulseView
        vaultPath="/test/vault"
        sidebarCollapsed
        onExpandSidebar={onExpandSidebar}
      />,
    )

    const button = await screen.findByRole('button', { name: 'Expand sidebar' })
    fireEvent.click(button)

    expect(onExpandSidebar).toHaveBeenCalledTimes(1)
  })
})
