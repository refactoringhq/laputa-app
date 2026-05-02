import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { WelcomeScreen } from './WelcomeScreen'
import tolariaIcon from '@/assets/tolaria-icon.svg'

const dragRegionMouseDown = vi.fn()

vi.mock('../hooks/useDragRegion', () => ({
  useDragRegion: () => ({ onMouseDown: dragRegionMouseDown }),
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
      expect(screen.getByText('Download the getting started vault')).toBeInTheDocument()
      expect(screen.queryByText(/~\/Documents\/Laputa/)).not.toBeInTheDocument()
    })

    it('shows offline guidance and disables the template option when offline', () => {
      render(<WelcomeScreen {...defaultProps} isOffline={true} />)
      expect(screen.getByTestId('welcome-create-vault')).toBeDisabled()
      expect(screen.getByText(/Requires internet — clone later/)).toBeInTheDocument()
    })

    it('calls onCreateEmptyVault after provider selection when create empty button is clicked', () => {
      const onCreateEmptyVault = vi.fn()
      render(<WelcomeScreen {...defaultProps} onCreateEmptyVault={onCreateEmptyVault} />)
      const button = screen.getByTestId('welcome-create-new')
      button.focus()
      fireEvent.keyDown(button, { key: 'Enter' })
      fireEvent.click(screen.getByTestId('select-provider-local'))
      expect(onCreateEmptyVault).toHaveBeenCalledWith('local-folder')
    })

    it('calls onCreateEmptyVault with icloud-drive after provider selection', () => {
      const onCreateEmptyVault = vi.fn()
      render(<WelcomeScreen {...defaultProps} onCreateEmptyVault={onCreateEmptyVault} />)
      const button = screen.getByTestId('welcome-create-new')
      button.focus()
      fireEvent.keyDown(button, { key: 'Enter' })
      fireEvent.click(screen.getByTestId('select-provider-icloud'))
      expect(onCreateEmptyVault).toHaveBeenCalledWith('icloud-drive')
    })

    it('calls onCreateEmptyVault when create empty button is activated with Enter then provider selected', async () => {
      const onCreateEmptyVault = vi.fn()
      render(<WelcomeScreen {...defaultProps} onCreateEmptyVault={onCreateEmptyVault} />)
      const button = screen.getByTestId('welcome-create-new')

      button.focus()
      fireEvent.keyDown(button, { key: 'Enter' })

      await waitFor(() => expect(screen.getByTestId('select-provider-local')).toBeInTheDocument())
      fireEvent.click(screen.getByTestId('select-provider-local'))
      expect(onCreateEmptyVault).toHaveBeenCalledWith('local-folder')
    })

    it('calls onCreateEmptyVault when create empty button is activated with Space then provider selected', async () => {
      const onCreateEmptyVault = vi.fn()
      render(<WelcomeScreen {...defaultProps} onCreateEmptyVault={onCreateEmptyVault} />)
      const button = screen.getByTestId('welcome-create-new')

      button.focus()
      fireEvent.keyDown(button, { key: ' ' })

      await waitFor(() => expect(screen.getByTestId('select-provider-local')).toBeInTheDocument())
      fireEvent.click(screen.getByTestId('select-provider-local'))
      expect(onCreateEmptyVault).toHaveBeenCalledWith('local-folder')
    })

    it('calls onCreateVault after provider selection when template button is activated', () => {
      const onCreateVault = vi.fn()
      render(<WelcomeScreen {...defaultProps} onCreateVault={onCreateVault} />)
      const button = screen.getByTestId('welcome-create-vault')
      button.focus()
      fireEvent.keyDown(button, { key: 'Enter' })
      fireEvent.click(screen.getByTestId('select-provider-local'))
      expect(onCreateVault).toHaveBeenCalledWith('local-folder')
    })

    it('calls onOpenFolder when open folder button is clicked', () => {
      const onOpenFolder = vi.fn()
      render(<WelcomeScreen {...defaultProps} onOpenFolder={onOpenFolder} />)
      fireEvent.click(screen.getByTestId('welcome-open-folder'))
      expect(onOpenFolder).toHaveBeenCalledOnce()
    })

    it('cycles onboarding actions with Tab and activates the selected action with Enter then provider', async () => {
      const onCreateEmptyVault = vi.fn()
      render(<WelcomeScreen {...defaultProps} onCreateEmptyVault={onCreateEmptyVault} />)

      fireEvent.keyDown(window, { key: 'Tab' })
      fireEvent.keyDown(window, { key: 'Enter' })

      await waitFor(() => expect(screen.getByTestId('select-provider-local')).toBeInTheDocument())
      fireEvent.click(screen.getByTestId('select-provider-local'))
      expect(onCreateEmptyVault).toHaveBeenCalledWith('local-folder')
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
  })

  describe('vault-missing mode', () => {
    const missingProps = {
      ...defaultProps,
      mode: 'vault-missing' as const,
      missingPath: '~/Laputa',
    }

    it('renders vault not found title', () => {
      render(<WelcomeScreen {...missingProps} />)
      expect(screen.getByText('Vault not found')).toBeInTheDocument()
      expect(screen.getByText(/could not be found on disk/)).toBeInTheDocument()
    })

    it('does not show the missing vault path in a badge', () => {
      render(<WelcomeScreen {...missingProps} />)
      expect(screen.queryByText('~/Laputa')).not.toBeInTheDocument()
    })

    it('shows "Choose a different folder" instead of "Open existing vault"', () => {
      render(<WelcomeScreen {...missingProps} />)
      expect(screen.getByTestId('welcome-open-folder')).toHaveTextContent('Choose a different folder')
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
