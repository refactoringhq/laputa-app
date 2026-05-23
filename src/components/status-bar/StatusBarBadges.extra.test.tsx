import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const openExternalUrlMock = vi.fn()

vi.mock('@/components/ui/action-tooltip', () => ({
  ActionTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    onKeyDown,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} onKeyDown={onKeyDown} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

vi.mock('../../utils/url', () => ({
  openExternalUrl: (...args: unknown[]) => openExternalUrlMock(...args),
}))

vi.mock('./useDismissibleLayer', () => ({
  useDismissibleLayer: vi.fn(),
}))

import {
  CommitBadge,
  ConflictBadge,
  NoRemoteBadge,
  SyncBadge,
} from './StatusBarBadges'

describe('StatusBarBadges extra coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens commit links externally and falls back to a plain hash badge without a URL', () => {
    const { rerender } = render(
      <CommitBadge info={{ shortHash: 'abc1234', commitUrl: 'https://example.com/commit/abc1234' }} />,
    )

    fireEvent.click(screen.getByTestId('status-commit-link'))
    expect(openExternalUrlMock).toHaveBeenCalledWith('https://example.com/commit/abc1234')

    rerender(<CommitBadge info={{ shortHash: 'def5678', commitUrl: null }} />)
    expect(screen.getByTestId('status-commit-hash')).toHaveTextContent('def5678')
  })

  it('renders actionable and passive no-remote badges', () => {
    const onAddRemote = vi.fn()
    const { rerender } = render(
      <NoRemoteBadge
        remoteStatus={{ branch: 'main', ahead: 0, behind: 0, hasRemote: false }}
        onAddRemote={onAddRemote}
      />,
    )

    fireEvent.click(screen.getByTestId('status-no-remote'))
    expect(onAddRemote).toHaveBeenCalledTimes(1)

    rerender(
      <NoRemoteBadge
        remoteStatus={{ branch: 'main', ahead: 0, behind: 0, hasRemote: false }}
      />,
    )

    expect(screen.getByTestId('status-no-remote')).toHaveTextContent('No remote')
    expect(screen.getByTestId('status-no-remote')).toHaveAttribute(
      'title',
      'This git vault has no remote configured. Commits stay local until you add one.',
    )
  })

  it('shows sync popup details, handles pull actions, and covers no-remote summaries', () => {
    const onTriggerSync = vi.fn()
    const { rerender } = render(
      <SyncBadge
        status="idle"
        lastSyncTime={Date.now() - 120_000}
        remoteStatus={{ branch: 'main', ahead: 2, behind: 1, hasRemote: true }}
        onTriggerSync={onTriggerSync}
      />,
    )

    fireEvent.click(screen.getByTestId('status-sync'))

    expect(screen.getByTestId('git-status-popup')).toHaveTextContent('main')
    expect(screen.getByText('↑ 2 ahead')).toBeInTheDocument()
    expect(screen.getByText('↓ 1 behind')).toBeInTheDocument()
    expect(screen.getByText(/Status: Synced/)).toBeInTheDocument()

    const pullButton = screen.getByRole('button', { name: 'Pull' })
    fireEvent.click(pullButton)
    expect(onTriggerSync).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('git-status-popup')).not.toBeInTheDocument()

    rerender(
      <SyncBadge
        status="idle"
        lastSyncTime={null}
        remoteStatus={null}
      />,
    )

    fireEvent.click(screen.getByTestId('status-sync'))
    expect(screen.getByTestId('git-status-popup')).toHaveTextContent('No remote configured')
  })

  it('routes conflict and pull-required sync states to their dedicated actions', () => {
    const onOpenConflictResolver = vi.fn()
    const onPullAndPush = vi.fn()
    const { rerender } = render(
      <SyncBadge
        status="conflict"
        lastSyncTime={null}
        remoteStatus={{ branch: 'main', ahead: 0, behind: 0, hasRemote: true }}
        onOpenConflictResolver={onOpenConflictResolver}
      />,
    )

    fireEvent.click(screen.getByTestId('status-sync'))
    expect(onOpenConflictResolver).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('git-status-popup')).not.toBeInTheDocument()

    rerender(
      <SyncBadge
        status="pull_required"
        lastSyncTime={null}
        remoteStatus={{ branch: 'main', ahead: 0, behind: 2, hasRemote: true }}
        onPullAndPush={onPullAndPush}
      />,
    )

    fireEvent.click(screen.getByTestId('status-sync'))
    expect(onPullAndPush).toHaveBeenCalledTimes(1)
  })

  it('renders clickable conflict badges with plural copy', () => {
    const onClick = vi.fn()
    render(<ConflictBadge count={2} onClick={onClick} />)

    fireEvent.click(screen.getByTestId('status-conflict-count'))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('status-conflict-count')).toHaveTextContent('2 conflicts')
  })
})
