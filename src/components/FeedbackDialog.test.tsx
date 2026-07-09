import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FeedbackDialog } from './FeedbackDialog'
import { TooltipProvider } from './ui/tooltip'
import {
  CIRCLECI_HOME_URL,
  CODACY_HOME_URL,
  CODESCENE_HOME_URL,
  REFACTORING_HOME_URL,
  TOLARIA_DEVELOPMENT_ARTICLE_URL,
  TOLARIA_GITHUB_CONTRIBUTING_URL,
  TOLARIA_GITHUB_DISCUSSIONS_URL,
  TOLARIA_GITHUB_ISSUES_URL,
  TOLARIA_GITHUB_PULL_REQUESTS_URL,
  TOLARIA_PRODUCT_BOARD_URL,
  UNBLOCKED_HOME_URL,
} from '../constants/feedback'
import { APP_COMMAND_EVENT_NAME, APP_COMMAND_IDS } from '../hooks/appCommandDispatcher'
import { rememberFeedbackDialogOpener } from '../lib/feedbackDialogOpener'

const { trackEvent } = vi.hoisted(() => ({
  trackEvent: vi.fn(),
}))

vi.mock('../lib/telemetry', () => ({
  trackEvent,
}))

vi.mock('../utils/url', () => ({
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
}))

const { openExternalUrl } = await import('../utils/url') as typeof import('../utils/url') & {
  openExternalUrl: ReturnType<typeof vi.fn>
}

function render(ui: Parameters<typeof rtlRender>[0]) {
  return rtlRender(ui, { wrapper: TooltipProvider })
}

describe('FeedbackDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  it('renders the contribution paths when open', async () => {
    render(<FeedbackDialog open={true} onClose={vi.fn()} buildNumber="b281" releaseChannel="alpha" />)
    expect(screen.getByTestId('feedback-dialog')).toBeInTheDocument()
    expect(screen.getByText('Contribute to Tolaria')).toBeInTheDocument()
    expect(screen.getByText('Pick the path that fits what you want to do! Any type of help is appreciated')).toBeInTheDocument()
    expect(screen.getByText('Join Refactoring')).toBeInTheDocument()
    expect(screen.getByText('Sponsors')).toBeInTheDocument()
    expect(screen.getByText('Feature requests')).toBeInTheDocument()
    expect(screen.getByText('Discussions')).toBeInTheDocument()
    expect(screen.getByText('Contribute code')).toBeInTheDocument()
    expect(screen.getByText('Report a bug')).toBeInTheDocument()
    expect(screen.getByText(/Refactoring is my newsletter and community/i)).toBeInTheDocument()
    expect(screen.getByText(/Tolaria is supported by a panel of tools/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'how I develop Tolaria' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Codacy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open CodeScene' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open CircleCI' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Unblocked' })).toBeInTheDocument()
    fireEvent.focus(screen.getByRole('button', { name: 'Open Codacy' }))
    expect(await screen.findAllByText('I use Codacy to ensure code security and quality')).not.toHaveLength(0)
    expect(screen.getByText('Search on the board first, upvote existing ideas, and create new posts when genuinely new!')).toBeInTheDocument()
    expect(screen.getByText('Use Discussions for questions, conversations, show & tell, and community context.')).toBeInTheDocument()
    expect(screen.getByText('Small, focused PRs are welcome. Check the board first so you build the right things!')).toBeInTheDocument()
    expect(screen.getByText('Explain how to reproduce, what you expected, vs what happened. Attach the diagnostics please!')).toBeInTheDocument()
    expect(screen.queryByText(/Sanitized and optional/i)).not.toBeInTheDocument()
  })

  it('localizes the contribution dialog', () => {
    render(<FeedbackDialog open={true} onClose={vi.fn()} buildNumber="b281" locale="zh-CN" releaseChannel="alpha" />)

    expect(screen.getByText('参与 Tolaria 贡献')).toBeInTheDocument()
    expect(screen.getByText('功能请求')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开产品看板' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制诊断' })).toBeInTheDocument()
    expect(screen.queryByText('Contribute to Tolaria')).not.toBeInTheDocument()
    expect(screen.queryByText('Feature requests')).not.toBeInTheDocument()
  })

  it('focuses the primary CTA when opened', async () => {
    render(<FeedbackDialog open={true} onClose={vi.fn()} buildNumber="b281" releaseChannel={null} />)
    const cta = screen.getByRole('button', { name: 'Check out Refactoring' })
    await waitFor(() => expect(cta).toHaveFocus())
  })

  it('opens the expected contribution links without closing the modal', async () => {
    const onClose = vi.fn()
    render(<FeedbackDialog open={true} onClose={onClose} buildNumber="b281" releaseChannel={null} />)

    fireEvent.click(screen.getByRole('button', { name: 'Check out Refactoring' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Codacy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open CodeScene' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open CircleCI' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Unblocked' }))
    fireEvent.click(screen.getByRole('button', { name: 'how I develop Tolaria' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Product Board' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Discussions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open PRs' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Guide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Issues' }))

    const expectedActions = [
      'newsletter_refactoring',
      'sponsor_codacy',
      'sponsor_codescene',
      'sponsor_circleci',
      'sponsor_unblocked',
      'sponsors_development_article',
      'feature_requests',
      'discussions',
      'pull_requests',
      'contributing_guide',
      'issues',
    ]
    for (const [index, action] of expectedActions.entries()) {
      expect(trackEvent).toHaveBeenNthCalledWith(index + 1, 'contribution_action_clicked', {
        action,
        surface: 'contribute_dialog',
      })
    }

    await waitFor(() => expect(openExternalUrl).toHaveBeenNthCalledWith(1, REFACTORING_HOME_URL))
    expect(openExternalUrl).toHaveBeenNthCalledWith(2, CODACY_HOME_URL)
    expect(openExternalUrl).toHaveBeenNthCalledWith(3, CODESCENE_HOME_URL)
    expect(openExternalUrl).toHaveBeenNthCalledWith(4, CIRCLECI_HOME_URL)
    expect(openExternalUrl).toHaveBeenNthCalledWith(5, UNBLOCKED_HOME_URL)
    expect(openExternalUrl).toHaveBeenNthCalledWith(6, TOLARIA_DEVELOPMENT_ARTICLE_URL)
    expect(openExternalUrl).toHaveBeenNthCalledWith(7, TOLARIA_PRODUCT_BOARD_URL)
    expect(openExternalUrl).toHaveBeenNthCalledWith(8, TOLARIA_GITHUB_DISCUSSIONS_URL)
    expect(openExternalUrl).toHaveBeenNthCalledWith(9, TOLARIA_GITHUB_PULL_REQUESTS_URL)
    expect(openExternalUrl).toHaveBeenNthCalledWith(10, TOLARIA_GITHUB_CONTRIBUTING_URL)
    expect(openExternalUrl).toHaveBeenNthCalledWith(11, TOLARIA_GITHUB_ISSUES_URL)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('feedback-dialog')).toBeInTheDocument()
  })

  it('copies a sanitized diagnostic bundle', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<FeedbackDialog open={true} onClose={vi.fn()} buildNumber="b281" releaseChannel="alpha" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy Diagnostics' }))

    expect(trackEvent).toHaveBeenCalledWith('contribution_action_clicked', {
      action: 'copy_diagnostics',
      surface: 'contribute_dialog',
    })
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0]?.[0]).toContain('Tolaria sanitized diagnostics')
    expect(writeText.mock.calls[0]?.[0]).toContain('Build: b281')
    expect(writeText.mock.calls[0]?.[0]).toContain('Release channel: alpha')
    expect(screen.getByText('Diagnostics copied.')).toBeInTheDocument()
  })

  it('shows a fallback message when a contribution link cannot be opened', async () => {
    openExternalUrl.mockRejectedValueOnce(new Error('blocked'))

    render(<FeedbackDialog open={true} onClose={vi.fn()} buildNumber="b281" releaseChannel={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Product Board' }))

    expect(await screen.findByText(/couldn’t open Product Board automatically/i)).toBeInTheDocument()
    expect(screen.getByText(TOLARIA_PRODUCT_BOARD_URL)).toBeInTheDocument()
  })

  it('closes when pressing Escape', () => {
    const onClose = vi.fn()
    render(<FeedbackDialog open={true} onClose={onClose} buildNumber="b281" releaseChannel={null} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes when clicking the top-right Close control', () => {
    const onClose = vi.fn()
    render(<FeedbackDialog open={true} onClose={onClose} buildNumber="b281" releaseChannel={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('reopens the command palette after closing when launched from it', () => {
    vi.useFakeTimers()

    const opener = document.createElement('input')
    opener.setAttribute('placeholder', 'Type a command...')
    document.body.appendChild(opener)
    rememberFeedbackDialogOpener(opener)

    const onClose = vi.fn()
    const handleReopen = vi.fn()
    window.addEventListener(APP_COMMAND_EVENT_NAME, handleReopen)

    const { rerender } = render(
      <FeedbackDialog open={false} onClose={onClose} buildNumber="b281" releaseChannel={null} />,
    )

    rerender(<FeedbackDialog open={true} onClose={onClose} buildNumber="b281" releaseChannel={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    vi.advanceTimersByTime(100)

    expect(onClose).toHaveBeenCalledOnce()
    expect(handleReopen).toHaveBeenCalledTimes(1)
    expect(handleReopen.mock.calls[0]?.[0]).toMatchObject({
      detail: APP_COMMAND_IDS.viewCommandPalette,
    })

    window.removeEventListener(APP_COMMAND_EVENT_NAME, handleReopen)
    opener.remove()
    vi.useRealTimers()
  })
})
