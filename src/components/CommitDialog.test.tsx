import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CommitDialog } from './CommitDialog'
import { formatShortcutDisplay } from '../hooks/appCommandCatalog'

describe('CommitDialog', () => {
  const onCommit = vi.fn()
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function getActionButton(name = 'Commit & Push') {
    return screen.getByRole('button', { name })
  }

  it('shows file count badge', () => {
    render(<CommitDialog open={true} modifiedCount={3} onCommit={onCommit} onClose={onClose} />)
    expect(screen.getByText('3 files changed')).toBeInTheDocument()
  })

  it('shows singular file count', () => {
    render(<CommitDialog open={true} modifiedCount={1} onCommit={onCommit} onClose={onClose} />)
    expect(screen.getByText('1 file changed')).toBeInTheDocument()
  })

  it('disables Commit button when message is empty', () => {
    render(<CommitDialog open={true} modifiedCount={3} onCommit={onCommit} onClose={onClose} />)
    expect(getActionButton()).toBeDisabled()
  })

  it('enables Commit button when message is typed', () => {
    render(<CommitDialog open={true} modifiedCount={3} onCommit={onCommit} onClose={onClose} />)
    const textarea = screen.getByPlaceholderText('Commit message...')
    fireEvent.change(textarea, { target: { value: 'fix: bug fix' } })
    expect(getActionButton()).not.toBeDisabled()
  })

  it('calls onCommit with trimmed message on button click', () => {
    render(<CommitDialog open={true} modifiedCount={3} onCommit={onCommit} onClose={onClose} />)
    const textarea = screen.getByPlaceholderText('Commit message...')
    fireEvent.change(textarea, { target: { value: '  fix: bug fix  ' } })
    fireEvent.click(getActionButton())
    expect(onCommit).toHaveBeenCalledWith('fix: bug fix')
  })

  it('calls onCommit on Cmd+Enter', () => {
    render(<CommitDialog open={true} modifiedCount={3} onCommit={onCommit} onClose={onClose} />)
    const textarea = screen.getByPlaceholderText('Commit message...')
    fireEvent.change(textarea, { target: { value: 'fix: test' } })
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
    expect(onCommit).toHaveBeenCalledWith('fix: test')
  })

  it('calls onClose on Escape', () => {
    render(<CommitDialog open={true} modifiedCount={3} onCommit={onCommit} onClose={onClose} />)
    const textarea = screen.getByPlaceholderText('Commit message...')
    fireEvent.keyDown(textarea, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose on Cancel button click', () => {
    render(<CommitDialog open={true} modifiedCount={3} onCommit={onCommit} onClose={onClose} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })

  it('does not call onCommit when message is whitespace only', () => {
    render(<CommitDialog open={true} modifiedCount={3} onCommit={onCommit} onClose={onClose} />)
    const textarea = screen.getByPlaceholderText('Commit message...')
    fireEvent.change(textarea, { target: { value: '   ' } })
    fireEvent.click(getActionButton())
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('renders nothing when not open', () => {
    const { container } = render(<CommitDialog open={false} modifiedCount={3} onCommit={onCommit} onClose={onClose} />)
    expect(container.querySelector('textarea')).toBeNull()
  })

  it('pre-populates message with suggestedMessage', () => {
    render(<CommitDialog open={true} modifiedCount={3} suggestedMessage="Update alpha, beta" onCommit={onCommit} onClose={onClose} />)
    const textarea = screen.getByPlaceholderText('Commit message...')
    expect(textarea).toHaveValue('Update alpha, beta')
  })

  it('enables Commit button when suggestedMessage is provided', () => {
    render(<CommitDialog open={true} modifiedCount={3} suggestedMessage="Update alpha" onCommit={onCommit} onClose={onClose} />)
    expect(getActionButton()).not.toBeDisabled()
  })

  it('submits suggestedMessage on Cmd+Enter without user edits', () => {
    render(<CommitDialog open={true} modifiedCount={3} suggestedMessage="Update alpha" onCommit={onCommit} onClose={onClose} />)
    const textarea = screen.getByPlaceholderText('Commit message...')
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
    expect(onCommit).toHaveBeenCalledWith('Update alpha')
  })

  it('allows user to edit the suggested message', () => {
    render(<CommitDialog open={true} modifiedCount={3} suggestedMessage="Update alpha" onCommit={onCommit} onClose={onClose} />)
    const textarea = screen.getByPlaceholderText('Commit message...')
    fireEvent.change(textarea, { target: { value: 'fix: corrected typo in alpha' } })
    fireEvent.click(getActionButton())
    expect(onCommit).toHaveBeenCalledWith('fix: corrected typo in alpha')
  })

  it('generates a message into the editable field and focuses it', async () => {
    const onGenerateMessage = vi.fn().mockResolvedValue('Update generated draft')
    render(
      <CommitDialog
        open={true}
        modifiedCount={3}
        onGenerateMessage={onGenerateMessage}
        onCommit={onCommit}
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Generate commit message from diff' }))
    const textarea = screen.getByPlaceholderText('Commit message...')

    await waitFor(() => expect(textarea).toHaveValue('Update generated draft'))
    await waitFor(() => expect(textarea).toHaveFocus())
    fireEvent.change(textarea, { target: { value: 'Update edited draft' } })
    fireEvent.click(getActionButton())

    expect(onGenerateMessage).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('Update edited draft')
  })

  it('applies a generated message from command-palette state updates', async () => {
    const { rerender } = render(
      <CommitDialog open={true} modifiedCount={3} onCommit={onCommit} onClose={onClose} />,
    )
    const textarea = screen.getByPlaceholderText('Commit message...')

    rerender(
      <CommitDialog
        open={true}
        modifiedCount={3}
        generatedMessage="Update from command palette"
        generatedMessageKey={1}
        onCommit={onCommit}
        onClose={onClose}
      />,
    )

    await waitFor(() => expect(textarea).toHaveValue('Update from command palette'))
    await waitFor(() => expect(textarea).toHaveFocus())
  })

  it('disables generation while a message is being drafted', () => {
    render(
      <CommitDialog
        open={true}
        modifiedCount={3}
        isGeneratingMessage={true}
        onGenerateMessage={vi.fn()}
        onCommit={onCommit}
        onClose={onClose}
      />,
    )

    expect(screen.getByRole('button', { name: 'Generate commit message from diff' })).toBeDisabled()
    expect(screen.getByText('Generating…')).toBeInTheDocument()
  })

  it('switches to local-only copy when commitMode is local', () => {
    const submitShortcut = formatShortcutDisplay({ display: '⌘↵' })
    render(<CommitDialog open={true} modifiedCount={2} commitMode="local" onCommit={onCommit} onClose={onClose} />)

    expect(screen.getByRole('heading', { name: 'Commit' })).toBeInTheDocument()
    expect(screen.getByText('This vault has no git remote configured. Tolaria will create a local commit only.')).toBeInTheDocument()
    expect(screen.getByText(`${submitShortcut} to commit locally`)).toBeInTheDocument()
    expect(getActionButton('Commit')).toBeDisabled()
  })

  it('shows a repository selector when multiple repositories are available', () => {
    render(
      <CommitDialog
        open={true}
        modifiedCount={2}
        repositories={[
          { path: '/default', label: 'Default', defaultForNewNotes: true },
          { path: '/work', label: 'Work', defaultForNewNotes: false },
        ]}
        selectedRepositoryPath="/work"
        onRepositoryChange={vi.fn()}
        onCommit={onCommit}
        onClose={onClose}
      />,
    )

    expect(screen.getByTestId('commit-repository-select')).toBeInTheDocument()
    expect(screen.getByText('Work')).toBeInTheDocument()
  })

  it('shows the commit author and warns when repository config overrides global identity', () => {
    render(
      <CommitDialog
        open={true}
        modifiedCount={2}
        authorIdentity={{
          name: 'Unexpected User',
          email: 'unexpected@example.com',
          source: 'repository',
          warning: 'local_overrides_global',
        }}
        onCommit={onCommit}
        onClose={onClose}
      />,
    )

    expect(screen.getByText('Commit author')).toBeInTheDocument()
    expect(screen.getByText('Unexpected User <unexpected@example.com>')).toBeInTheDocument()
    expect(screen.getByText("Repository Git author differs from your global Git author. Cancel and update this vault's git config before committing if it looks wrong.")).toBeInTheDocument()
  })
})
