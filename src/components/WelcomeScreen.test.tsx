import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { WelcomeScreen } from './WelcomeScreen'
import tolariaIcon from '@/assets/tolaria-icon.svg'
import { TOLARIA_FIRST_LAUNCH_DOCS_URL } from '@/constants/feedback'

const dragRegionMouseDown = vi.fn()
const openExternalUrl = vi.fn()

vi.mock('../hooks/useDragRegion', () => ({
  useDragRegion: () => ({ onMouseDown: dragRegionMouseDown }),
}))
vi.mock('@/utils/url', () => ({
  openExternalUrl: (...args: unknown[]) => openExternalUrl(...args),
}))

const defaultProps = {
  mode: 'welcome' as const,
  defaultVaultPath: '~/Documents/Laputa',
  onCreateVault: vi.fn(),
  onRetryCreateVault: vi.fn(),
  onCreateEmptyVault: vi.fn(),
  onOpenFolder: vi.fn(),
  isOffline: false,
  creatingAction: null as 'template' | 'empty' | null,
  error: null,
  canRetryTemplate: false,
}

describe('WelcomeScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('welcome mode', () => {
    it('renders welcome title and subtitle', () => {
      render(<WelcomeScreen {...defaultProps} />)
      expect(screen.getByText('Welcome to Tolaria')).toBeInTheDocument()
      expect(screen.getByText('Markdown knowledge management for the age of AI')).toBeInTheDocument()
    })

    it('renders the local Tolaria branding icon', () => {
      render(<WelcomeScreen {...defaultProps} />)

      const brandIcon = screen.getByAltText('Tolaria icon')
      expect(brandIcon).toHaveAttribute('src', tolariaIcon)
    })

    it('shows the onboarding actions in the guided-first order', () => {
      render(<WelcomeScreen {...defaultProps} />)

      const optionButtons = screen.getAllByRole('button')
      expect(optionButtons[0]).toBe(screen.getByTestId('welcome-create-vault'))
      expect(optionButtons[1]).toBe(screen.getByTestId('welcome-create-new'))
      expect(optionButtons[2]).toBe(screen.getByTestId('welcome-open-folder'))
    })

    it('focuses the first action for keyboard users', () => {
      render(<WelcomeScreen {...defaultProps} />)
      expect(screen.getByTestId('welcome-create-vault')).toHaveFocus()
    })

    it('shows the simplified template option description', () => {
      render(<WelcomeScreen {...defaultProps} />)
      expect(screen.getByText('Download the Getting Started vault')).toBeInTheDocument()
      expect(screen.queryByText(/~\/Documents\/Laputa/)).not.toBeInTheDocument()
    })

    it('shows offline guidance and disables the template option when offline', () => {
      render(<WelcomeScreen {...defaultProps} isOffline={true} />)
      expect(screen.getByTestId('welcome-create-vault')).toBeDisabled()
      expect(screen.getByText(/Requires internet - clone later/)).toBeInTheDocument()
    })

    it('calls onCreateEmptyVault when create empty button is clicked', () => {
      const onCreateEmptyVault = vi.fn()
      render(<WelcomeScreen {...defaultProps} onCreateEmptyVault={onCreateEmptyVault} />)
      fireEvent.click(screen.getByTestId('welcome-create-new'))
      expect(onCreateEmptyVault).toHaveBeenCalledOnce()
    })

    it('calls onCreateEmptyVault when create empty button is activated with Enter', () => {
      const onCreateEmptyVault = vi.fn()
      render(<WelcomeScreen {...defaultProps} onCreateEmptyVault={onCreateEmptyVault} />)
      const button = screen.getByTestId('welcome-create-new')

      button.focus()
      fireEvent.keyDown(button, { key: 'Enter' })

      expect(onCreateEmptyVault).toHaveBeenCalledOnce()
    })

    it('calls onCreateEmptyVault when create empty button is activated with Space', () => {
      const onCreateEmptyVault = vi.fn()
      render(<WelcomeScreen {...defaultProps} onCreateEmptyVault={onCreateEmptyVault} />)
      const button = screen.getByTestId('welcome-create-new')

      button.focus()
      fireEvent.keyDown(button, { key: ' ' })

      expect(onCreateEmptyVault).toHaveBeenCalledOnce()
    })

    it('calls onCreateVault when template button is clicked', () => {
      const onCreateVault = vi.fn()
      render(<WelcomeScreen {...defaultProps} onCreateVault={onCreateVault} />)
      fireEvent.click(screen.getByTestId('welcome-create-vault'))
      expect(onCreateVault).toHaveBeenCalledOnce()
    })

    it('calls onOpenFolder when open folder button is clicked', () => {
      const onOpenFolder = vi.fn()
      render(<WelcomeScreen {...defaultProps} onOpenFolder={onOpenFolder} />)
      fireEvent.click(screen.getByTestId('welcome-open-folder'))
      expect(onOpenFolder).toHaveBeenCalledOnce()
    })

    it('cycles onboarding actions with Tab and activates the selected action with Enter', () => {
      const onCreateEmptyVault = vi.fn()
      render(<WelcomeScreen {...defaultProps} onCreateEmptyVault={onCreateEmptyVault} />)

      fireEvent.keyDown(window, { key: 'Tab' })
      fireEvent.keyDown(window, { key: 'Enter' })

      expect(onCreateEmptyVault).toHaveBeenCalledOnce()
    })

    it('disables all buttons while creating', () => {
      render(<WelcomeScreen {...defaultProps} creatingAction="template" />)
      expect(screen.getByTestId('welcome-create-new')).toBeDisabled()
      expect(screen.getByTestId('welcome-open-folder')).toBeDisabled()
      expect(screen.getByTestId('welcome-create-vault')).toBeDisabled()
    })

    it('shows loading text on template button while creating', () => {
      render(<WelcomeScreen {...defaultProps} creatingAction="template" />)
      expect(screen.getByTestId('welcome-create-vault')).toHaveTextContent(/Downloading template/)
      expect(screen.getByTestId('welcome-status')).toHaveAttribute('aria-live', 'polite')
    })

    it('shows loading text on create-new button while creating an empty vault', () => {
      render(<WelcomeScreen {...defaultProps} creatingAction="empty" />)
      expect(screen.getByTestId('welcome-create-new')).toHaveTextContent(/Creating vault/)
    })

    it('shows error message when error is set', () => {
      render(<WelcomeScreen {...defaultProps} error="Permission denied" />)
      expect(screen.getByTestId('welcome-error')).toHaveTextContent('Permission denied')
      expect(screen.getByTestId('welcome-error')).toHaveAttribute('aria-live', 'assertive')
    })

    it('does not show error when error is null', () => {
      render(<WelcomeScreen {...defaultProps} />)
      expect(screen.queryByTestId('welcome-error')).not.toBeInTheDocument()
    })

    it('shows a retry button after template download errors', () => {
      const onRetryCreateVault = vi.fn()
      render(
        <WelcomeScreen
          {...defaultProps}
          error="Could not download Getting Started vault. Check your connection and try again."
          canRetryTemplate={true}
          onRetryCreateVault={onRetryCreateVault}
        />,
      )

      fireEvent.click(screen.getByTestId('welcome-retry-template'))
      expect(onRetryCreateVault).toHaveBeenCalledOnce()
    })

    it('does not show path badge in welcome mode', () => {
      render(<WelcomeScreen {...defaultProps} />)
      expect(screen.queryByText('~/Laputa')).not.toBeInTheDocument()
    })

    it('opens the first-launch docs from the welcome card', () => {
      render(<WelcomeScreen {...defaultProps} />)
      fireEvent.click(screen.getByTestId('welcome-docs-link'))
      expect(openExternalUrl).toHaveBeenCalledWith(TOLARIA_FIRST_LAUNCH_DOCS_URL)
    })
  })

  describe('vault-missing mode', () => {
    const missingProps = {
      ...defaultProps,
      mode: 'vault-missing' as const,
      missingPath: '~/Laputa',
    }

    it('keeps the missing-vault state framed as welcome', () => {
      render(<WelcomeScreen {...missingProps} />)
      expect(screen.getByText('Welcome to Tolaria')).toBeInTheDocument()
      expect(screen.getByText(/folder may have moved or been deleted/)).toBeInTheDocument()
    })

    it('does not show the missing vault path in a badge', () => {
      render(<WelcomeScreen {...missingProps} />)
      expect(screen.queryByText('~/Laputa')).not.toBeInTheDocument()
    })

    it('keeps the existing-vault action label in the friendly recovery state', () => {
      render(<WelcomeScreen {...missingProps} />)
      expect(screen.getByTestId('welcome-open-folder')).toHaveTextContent('Open existing vault')
    })
  })

  describe('data-testid', () => {
    it('has welcome-screen container testid', () => {
      render(<WelcomeScreen {...defaultProps} />)
      expect(screen.getByTestId('welcome-screen')).toBeInTheDocument()
    })

    it('uses the surrounding surface as a drag region and excludes the card', () => {
      render(<WelcomeScreen {...defaultProps} />)

      const screenContainer = screen.getByTestId('welcome-screen')
      fireEvent.mouseDown(screenContainer)

      expect(dragRegionMouseDown).toHaveBeenCalledOnce()
      expect(screenContainer.querySelector('[data-no-drag]')).not.toBeNull()
    })
  })
})
