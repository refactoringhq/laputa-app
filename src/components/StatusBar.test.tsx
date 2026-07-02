import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, within } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { StatusBar } from './StatusBar'
import { StatusBarPrimarySection } from './status-bar/StatusBarSections'
import type { VaultOption } from './StatusBar'

const vaults: VaultOption[] = [
  { label: 'Main Vault', path: '/Users/luca/Laputa', alias: 'main', mounted: true },
  { label: 'Work Vault', path: '/Users/luca/Work', alias: 'work', mounted: false },
]

const DEFAULT_WINDOW_WIDTH = 1280

function setWindowWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  })
}

function renderDenseStatusBar() {
  return render(
    <StatusBar
      noteCount={100}
      modifiedCount={5}
      vaultPath="/Users/luca/Laputa"
      vaults={vaults}
      onSwitchVault={vi.fn()}
      remoteStatus={{ branch: 'main', ahead: 0, behind: 0, hasRemote: false }}
      onCommitPush={vi.fn()}
      onClickPulse={vi.fn()}
      onOpenFeedback={vi.fn()}
      buildNumber="b281"
      onCheckForUpdates={vi.fn()}
      mcpStatus="not_installed"
    />
  )
}

async function expectTooltip(trigger: HTMLElement, ...parts: string[]) {
  act(() => {
    fireEvent.focus(trigger)
  })
  const tooltip = await screen.findByRole('tooltip')
  for (const part of parts) {
    expect(tooltip).toHaveTextContent(part)
  }
  act(() => {
    fireEvent.blur(trigger)
  })
}

describe('StatusBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setWindowWidth(DEFAULT_WINDOW_WIDTH)
  })

  it('does not display the bottom-bar note count readout', () => {
    render(<StatusBar noteCount={9200} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)
    expect(screen.queryByText('9,200 notes')).not.toBeInTheDocument()
  })

  it('displays build number when provided', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} buildNumber="b223" />)
    expect(screen.getByText('b223')).toBeInTheDocument()
  })

  it('displays fallback build number when not provided', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)
    expect(screen.getByText('b?')).toBeInTheDocument()
  })

  it('shows the vault reload badge while a reload is active', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} isVaultReloading />)
    expect(screen.getByTestId('status-vault-reloading')).toHaveAccessibleName('Reloading vault from disk')
  })

  it('calls onCheckForUpdates when clicking build number', () => {
    const onCheckForUpdates = vi.fn()
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} buildNumber="b281" onCheckForUpdates={onCheckForUpdates} />)
    fireEvent.click(screen.getByTestId('status-build-number'))
    expect(onCheckForUpdates).toHaveBeenCalledOnce()
  })

  it('build number shows the update tooltip on focus', async () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} buildNumber="b281" onCheckForUpdates={vi.fn()} />)
    await expectTooltip(screen.getByRole('button', { name: 'Check for updates' }), 'Check for updates')
  }, 10_000)

  it('displays the active git branch in the status bar', () => {
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        remoteStatus={{ branch: 'feature/drafts', ahead: 0, behind: 0, hasRemote: true }}
      />,
    )
    expect(screen.getByTestId('status-git-branch')).toHaveTextContent('feature/drafts')
    expect(screen.getByTestId('status-git-branch')).toHaveAccessibleName('Current branch: feature/drafts')
  })

  it('shows Contribute button when callback is provided', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} onOpenFeedback={vi.fn()} />)
    expect(screen.getByTestId('status-feedback')).toBeInTheDocument()
    expect(screen.getByText('Contribute')).toBeInTheDocument()
  })

  it('calls onOpenFeedback when Contribute is clicked', () => {
    const onOpenFeedback = vi.fn()
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} onOpenFeedback={onOpenFeedback} />)
    fireEvent.click(screen.getByTestId('status-feedback'))
    expect(onOpenFeedback).toHaveBeenCalledOnce()
  })

  it('shows and opens Docs from the bottom bar', () => {
    const onOpenDocs = vi.fn()
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} onOpenDocs={onOpenDocs} />)
    expect(screen.getByTestId('status-docs')).toHaveTextContent('Docs')

    fireEvent.click(screen.getByTestId('status-docs'))

    expect(onOpenDocs).toHaveBeenCalledOnce()
  })

  it('shows a theme toggle instead of the notifications placeholder', () => {
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        themeMode="light"
        onToggleThemeMode={vi.fn()}
      />,
    )

    expect(screen.getByTestId('status-theme-mode')).toHaveAccessibleName('Switch to dark mode')
    expect(screen.queryByLabelText('Notifications are coming soon')).not.toBeInTheDocument()
  })

  it('end-aligns the theme tooltip to keep it inside the right window edge', async () => {
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        themeMode="light"
        onToggleThemeMode={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    )

    act(() => {
      fireEvent.focus(screen.getByTestId('status-theme-mode'))
    })
    const tooltip = await screen.findByTestId('status-theme-mode-tooltip')
    expect(tooltip).toHaveAttribute('data-align', 'end')
    expect(tooltip).toHaveTextContent('Switch to dark mode')
  })

  it('calls onToggleThemeMode from the bottom bar', () => {
    const onToggleThemeMode = vi.fn()
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        themeMode="dark"
        onToggleThemeMode={onToggleThemeMode}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }))
    expect(onToggleThemeMode).toHaveBeenCalledOnce()
  })

  it('displays active vault name', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)
    expect(screen.getByText('Main Vault')).toBeInTheDocument()
  })

  it('shows fallback "Vault" when vault path does not match', () => {
    render(<StatusBar noteCount={100} vaultPath="/unknown/path" vaults={vaults} onSwitchVault={vi.fn()} />)
    expect(screen.getByText('Vault')).toBeInTheDocument()
  })

  it('opens vault menu on click and shows all vault options', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)

    // Click the vault button to open menu
    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))

    expect(screen.getByText('Work Vault')).toBeInTheDocument()
  })

  it('does not show workspace management or mount controls before opt-in', () => {
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        onUpdateWorkspaceIdentity={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))

    expect(screen.queryByTestId('vault-menu-manage-vaults')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('mounts and unmounts workspaces from the vault menu after opt-in', () => {
    const onSwitchVault = vi.fn()
    const onUpdateWorkspaceIdentity = vi.fn()
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        multiWorkspaceEnabled={true}
        onSwitchVault={onSwitchVault}
        onUpdateWorkspaceIdentity={onUpdateWorkspaceIdentity}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Work Vault in the unified graph' }))

    expect(onUpdateWorkspaceIdentity).toHaveBeenCalledWith('/Users/luca/Work', { mounted: true })
    expect(onSwitchVault).not.toHaveBeenCalled()
    expect(screen.getByText('Work Vault')).toBeInTheDocument()
  })

  it('shows the active workspace real mount state so stale unmounted defaults can be repaired', () => {
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={[
          { ...vaults[0], mounted: false },
          vaults[1],
        ]}
        multiWorkspaceEnabled={true}
        onSwitchVault={vi.fn()}
        onUpdateWorkspaceIdentity={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))

    const activeCheckbox = screen.getByRole('checkbox', { name: 'Include Main Vault in the unified graph' })
    expect(activeCheckbox).not.toBeChecked()
    expect(activeCheckbox).not.toBeDisabled()
  })

  it('uses the expanded multi-workspace vault picker layout', () => {
    const onOpenVaultSettings = vi.fn()
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={[
          { ...vaults[0], color: 'purple' },
          { ...vaults[1], color: 'green' },
        ]}
        multiWorkspaceEnabled={true}
        onSwitchVault={vi.fn()}
        onOpenVaultSettings={onOpenVaultSettings}
        onCreateEmptyVault={vi.fn()}
        onUpdateWorkspaceIdentity={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))

    expect(screen.getByTestId('vault-menu-popover')).toHaveStyle({ minWidth: '320px' })
    expect(screen.getByText('Available vaults')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Manage vaults' }))
    expect(onOpenVaultSettings).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    const activeItem = screen.getByTestId('vault-menu-item-Main Vault')
    const defaultLabel = within(activeItem).getByTestId('vault-menu-default-label')
    const activeBadge = within(activeItem).getByTestId('vault-menu-workspace-badge-Main Vault')
    expect(within(activeItem).getByTestId('vault-menu-item-label-Main Vault').className).toContain('text-[12px]')
    expect(within(activeItem).getByTestId('vault-menu-item-label-Main Vault').getAttribute('style')).toContain('background: transparent')
    expect(defaultLabel).toHaveTextContent('Default')
    expect(activeBadge).toHaveTextContent('MV')
    expect(defaultLabel.compareDocumentPosition(activeBadge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const workBadge = screen.getByTestId('vault-menu-workspace-badge-Work Vault')
    expect(workBadge).toHaveTextContent('WV')
    expect(workBadge.getAttribute('style')).toContain('border-color: var(--accent-green)')

    const createAction = screen.getByTestId('vault-menu-create-empty')
    expect(createAction.className).toContain('text-[12px]')
    expect(createAction.getAttribute('style')).toContain('color: var(--muted-foreground)')
  })

  it('calls onSwitchVault when selecting a different vault', () => {
    const onSwitchVault = vi.fn()
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={onSwitchVault} />)

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    // Click "Work Vault"
    fireEvent.click(screen.getByText('Work Vault'))

    expect(onSwitchVault).toHaveBeenCalledWith('/Users/luca/Work')
  })

  it('sets the default workspace instead of switching vaults after multi-workspace opt-in', () => {
    const onSetDefaultWorkspace = vi.fn()
    const onSwitchVault = vi.fn()
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        defaultWorkspacePath="/Users/luca/Laputa"
        vaults={vaults}
        multiWorkspaceEnabled={true}
        onSwitchVault={onSwitchVault}
        onSetDefaultWorkspace={onSetDefaultWorkspace}
        onUpdateWorkspaceIdentity={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    fireEvent.click(screen.getByText('Work Vault'))

    expect(onSetDefaultWorkspace).toHaveBeenCalledWith('/Users/luca/Work')
    expect(onSwitchVault).not.toHaveBeenCalled()
  })

  it('unmounts the current default by moving the default to another included workspace first', () => {
    const onSetDefaultWorkspace = vi.fn()
    const onUpdateWorkspaceIdentity = vi.fn()
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        defaultWorkspacePath="/Users/luca/Laputa"
        vaults={[
          { ...vaults[0], mounted: true },
          { ...vaults[1], mounted: true },
        ]}
        multiWorkspaceEnabled={true}
        onSwitchVault={vi.fn()}
        onSetDefaultWorkspace={onSetDefaultWorkspace}
        onUpdateWorkspaceIdentity={onUpdateWorkspaceIdentity}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Main Vault in the unified graph' }))

    expect(onSetDefaultWorkspace).toHaveBeenCalledWith('/Users/luca/Work')
    expect(onUpdateWorkspaceIdentity).toHaveBeenCalledWith('/Users/luca/Laputa', { mounted: false })
  })

  it('closes vault menu when clicking outside', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    expect(screen.getByText('Work Vault')).toBeInTheDocument()

    // Click outside the menu
    fireEvent.mouseDown(document.body)

    expect(screen.queryByText('Work Vault')).not.toBeInTheDocument()
  })

  it('toggles vault menu open and closed', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)

    const vaultButton = screen.getByRole('button', { name: 'Switch vault' })
    fireEvent.click(vaultButton)
    expect(screen.getByText('Work Vault')).toBeInTheDocument()

    // Click again to close
    fireEvent.click(vaultButton)
    expect(screen.queryByText('Work Vault')).not.toBeInTheDocument()
  })

  it('shows "Open local folder" option in vault menu', () => {
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} onOpenLocalFolder={vi.fn()} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    expect(screen.getByText('Open local folder')).toBeInTheDocument()
  })

  it('calls onOpenLocalFolder when clicking "Open local folder"', () => {
    const onOpenLocalFolder = vi.fn()
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} onOpenLocalFolder={onOpenLocalFolder} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    fireEvent.click(screen.getByText('Open local folder'))
    expect(onOpenLocalFolder).toHaveBeenCalledOnce()
  })

  it('shows "Create empty vault" option in vault menu', () => {
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} onCreateEmptyVault={vi.fn()} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    expect(screen.getByText('Create empty vault')).toBeInTheDocument()
  })

  it('calls onCreateEmptyVault when clicking "Create empty vault"', () => {
    const onCreateEmptyVault = vi.fn()
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} onCreateEmptyVault={onCreateEmptyVault} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    fireEvent.click(screen.getByText('Create empty vault'))
    expect(onCreateEmptyVault).toHaveBeenCalledOnce()
  })

  it('shows add-vault options in vault menu', () => {
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        onCreateEmptyVault={vi.fn()}
        onOpenLocalFolder={vi.fn()}
        onCloneVault={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    expect(screen.getByText('Create empty vault')).toBeInTheDocument()
    expect(screen.getByText('Open local folder')).toBeInTheDocument()
    expect(screen.getByText('Clone Git repo')).toBeInTheDocument()
  })

  it('shows the Getting Started clone action in the vault menu when provided', () => {
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        onCloneGettingStarted={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    expect(screen.getByText('Clone Getting Started Vault')).toBeInTheDocument()
  })

  it('calls onCloneGettingStarted when clicking the vault menu action', () => {
    const onCloneGettingStarted = vi.fn()
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        onCloneGettingStarted={onCloneGettingStarted}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    fireEvent.click(screen.getByText('Clone Getting Started Vault'))
    expect(onCloneGettingStarted).toHaveBeenCalledOnce()
  })

  it('exposes an in-row, hover-revealed remove action for non-active vaults', () => {
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        onRemoveVault={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))

    const item = screen.getByTestId('vault-menu-item-Work Vault')
    const removeAction = screen.getByTestId('vault-menu-remove-Work Vault')

    expect(item.className).toContain('hover:bg-[var(--hover)]')
    expect(removeAction.compareDocumentPosition(within(item).getByText('Work Vault')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(removeAction.className).not.toContain('absolute')
    expect(removeAction.className).not.toContain('right-1')
    expect(removeAction.className).toContain('group-hover:opacity-100')
    expect(removeAction.className).toContain('group-focus-within:opacity-100')
    expect(removeAction.className).toContain('pointer-events-none')
    expect(screen.getByRole('button', { name: 'Remove Work Vault from list' })).toBeInTheDocument()
  })

  it('confirms before removing a vault from the vault menu', () => {
    const onRemoveVault = vi.fn()
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        onRemoveVault={onRemoveVault}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Work Vault from list' }))

    expect(onRemoveVault).not.toHaveBeenCalled()
    expect(screen.getByTestId('confirm-delete-dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove vault' }))

    expect(onRemoveVault).toHaveBeenCalledWith('/Users/luca/Work')
  })

  it('shows Changes badge with count when modifiedCount is > 0', () => {
    render(<StatusBar noteCount={100} modifiedCount={3} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)
    expect(screen.getByTestId('status-modified-count')).toBeInTheDocument()
    expect(screen.getByText('Changes')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('keeps the bottom bar compact and unwrapped at medium widths', () => {
    setWindowWidth(980)
    renderDenseStatusBar()

    expect(screen.getByTestId('status-bar')).toHaveStyle({
      flexWrap: 'nowrap',
      height: '30px',
    })
    expect(screen.getByTestId('status-commit-push')).toBeInTheDocument()
    expect(screen.getByTestId('status-pulse')).toBeInTheDocument()
    expect(screen.getByTestId('status-feedback')).toBeInTheDocument()
    expect(screen.queryByText('Commit')).not.toBeInTheDocument()
    expect(screen.queryByText('History')).not.toBeInTheDocument()
    expect(screen.queryByText('Contribute')).not.toBeInTheDocument()
  })

  it('collapses status labels to icon-first controls at very narrow widths', () => {
    setWindowWidth(920)
    renderDenseStatusBar()

    expect(screen.getByTestId('status-bar')).toHaveStyle({
      flexWrap: 'nowrap',
      height: '30px',
    })
    expect(screen.getByTestId('status-commit-push')).toBeInTheDocument()
    expect(screen.getByTestId('status-pulse')).toBeInTheDocument()
    expect(screen.getByTestId('status-feedback')).toBeInTheDocument()
    expect(screen.getByTestId('status-build-number')).toBeInTheDocument()
    expect(screen.queryByTestId('status-claude-code')).not.toBeInTheDocument()
    expect(screen.queryByText('Commit')).not.toBeInTheDocument()
    expect(screen.queryByText('History')).not.toBeInTheDocument()
    expect(screen.queryByText('Contribute')).not.toBeInTheDocument()
    expect(screen.queryByText('No remote')).not.toBeInTheDocument()
    expect(screen.queryByText('MCP')).not.toBeInTheDocument()
    expect(screen.queryByText('b281')).not.toBeInTheDocument()
    expect(screen.queryByText('Claude Code missing')).not.toBeInTheDocument()
  })

  it('stacks the footer into two rows once the narrow-width breakpoint is crossed', () => {
    setWindowWidth(900)
    renderDenseStatusBar()

    expect(screen.getByTestId('status-bar')).toHaveStyle({
      flexWrap: 'wrap',
      height: 'auto',
    })
    expect(screen.getByTestId('status-commit-push')).toBeInTheDocument()
    expect(screen.getByTestId('status-pulse')).toBeInTheDocument()
    expect(screen.getByTestId('status-feedback')).toBeInTheDocument()
  })

  it('does not render the legacy AI agent control in the status bar', () => {
    setWindowWidth(920)
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
      />
    )

    expect(screen.queryByTestId('status-ai-agents')).not.toBeInTheDocument()
    expect(screen.queryByText('Claude')).not.toBeInTheDocument()
  })

  it('does not show Changes badge when modifiedCount is 0', () => {
    render(<StatusBar noteCount={100} modifiedCount={0} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)
    expect(screen.queryByTestId('status-modified-count')).not.toBeInTheDocument()
  })

  it('does not show Changes badge when modifiedCount is not provided', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)
    expect(screen.queryByTestId('status-modified-count')).not.toBeInTheDocument()
  })

  it('closes menu after clicking "Open local folder"', () => {
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} onOpenLocalFolder={vi.fn()} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    fireEvent.click(screen.getByText('Open local folder'))
    // Menu should close after clicking an action
    expect(screen.queryByText('Open local folder')).not.toBeInTheDocument()
  })

  it('calls onClickPending when clicking the pending count', () => {
    const onClickPending = vi.fn()
    render(
      <StatusBar noteCount={100} modifiedCount={5} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} onClickPending={onClickPending} />
    )
    fireEvent.click(screen.getByTestId('status-modified-count'))
    expect(onClickPending).toHaveBeenCalledOnce()
  })

  it('pending changes tooltip is available on keyboard focus', async () => {
    render(
      <StatusBar noteCount={100} modifiedCount={3} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} onClickPending={vi.fn()} />
    )
    await expectTooltip(screen.getByRole('button', { name: 'View pending changes' }), 'View pending changes')
  })

  it('shows MCP warning badge when status is not_installed', async () => {
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} mcpStatus="not_installed" />
    )
    expect(screen.getByTestId('status-mcp')).toBeInTheDocument()
    await expectTooltip(screen.getByRole('button', { name: 'External AI tools not connected — click to set up' }), 'External AI tools not connected — click to set up')
  })

  it('hides MCP badge when status is installed', () => {
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} mcpStatus="installed" />
    )
    expect(screen.queryByTestId('status-mcp')).not.toBeInTheDocument()
  })

  it('hides MCP badge when status is checking', () => {
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} mcpStatus="checking" />
    )
    expect(screen.queryByTestId('status-mcp')).not.toBeInTheDocument()
  })

  it('hides MCP badge when no mcpStatus prop provided', () => {
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />
    )
    expect(screen.queryByTestId('status-mcp')).not.toBeInTheDocument()
  })

  it('hides MCP badge when AI features are disabled', () => {
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} aiFeaturesEnabled={false} mcpStatus="not_installed" />
    )
    expect(screen.queryByTestId('status-mcp')).not.toBeInTheDocument()
  })

  it('calls onInstallMcp when clicking MCP badge with not_installed status', () => {
    const onInstallMcp = vi.fn()
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} mcpStatus="not_installed" onInstallMcp={onInstallMcp} />
    )
    fireEvent.click(screen.getByTestId('status-mcp'))
    expect(onInstallMcp).toHaveBeenCalledOnce()
  })

  it('shows Pull required label when syncStatus is pull_required', () => {
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} syncStatus="pull_required" />
    )
    expect(screen.getByText('Pull required')).toBeInTheDocument()
  })

  it('shows an offline chip when offline', () => {
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} isOffline={true} />
    )
    expect(screen.getByTestId('status-offline')).toHaveTextContent('Offline')
  })

  it('shows a no-remote chip when the active git vault has no remote', () => {
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        remoteStatus={{ branch: 'main', ahead: 0, behind: 0, hasRemote: false }}
      />
    )
    expect(screen.getByTestId('status-no-remote')).toHaveTextContent('No remote')
  })

  it('opens the add-remote flow when clicking the no-remote chip', () => {
    const onAddRemote = vi.fn()
    render(
      <TooltipProvider>
        <StatusBarPrimarySection
          modifiedCount={0}
          vaultPath="/Users/luca/Laputa"
          vaults={vaults}
          onSwitchVault={vi.fn()}
          onAddRemote={onAddRemote}
          syncStatus="idle"
          lastSyncTime={null}
          conflictCount={0}
          remoteStatus={{ branch: 'main', ahead: 0, behind: 0, hasRemote: false }}
        />
      </TooltipProvider>
    )

    fireEvent.click(screen.getByTestId('status-no-remote'))
    expect(onAddRemote).toHaveBeenCalledOnce()
  })

  it('calls onPullAndPush when clicking Pull required badge', () => {
    const onPullAndPush = vi.fn()
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} syncStatus="pull_required" onPullAndPush={onPullAndPush} />
    )
    fireEvent.click(screen.getByTestId('status-sync'))
    expect(onPullAndPush).toHaveBeenCalledOnce()
  })

  it('shows git status popup when clicking idle sync badge', () => {
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        syncStatus="idle"
        remoteStatus={{ branch: 'main', ahead: 2, behind: 1, hasRemote: true }}
      />
    )
    fireEvent.click(screen.getByTestId('status-sync'))
    expect(screen.getByTestId('status-bar')).toHaveStyle({ zIndex: '30' })
    const popup = screen.getByTestId('git-status-popup')
    expect(popup).toBeInTheDocument()
    expect(within(popup).getByText('Branch: main')).toBeInTheDocument()
    expect(screen.getByText(/2 ahead/)).toBeInTheDocument()
    expect(screen.getByText(/1 behind/)).toBeInTheDocument()
  })

  it('keeps sync controls vault-agnostic when multiple vaults are active', () => {
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        multiWorkspaceEnabled={true}
        onSwitchVault={vi.fn()}
        repositories={[
          { path: '/Users/luca/Laputa', label: 'Main Vault', defaultForNewNotes: true },
          { path: '/Users/luca/Work', label: 'Work Vault', defaultForNewNotes: false },
        ]}
        selectedRepositoryPath="/Users/luca/Work"
        onRepositoryChange={vi.fn()}
        syncStatus="idle"
        remoteStatus={{ branch: 'main', ahead: 0, behind: 0, hasRemote: true }}
      />
    )

    expect(screen.getByTestId('status-sync')).not.toHaveTextContent('Work Vault')
    expect(screen.getByTestId('status-sync')).toHaveTextContent('Not synced')
    fireEvent.click(screen.getByTestId('status-sync'))
    expect(screen.queryByTestId('git-status-repository-select')).not.toBeInTheDocument()
  })

  it('shows History badge in status bar', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} isGitVault />)
    expect(screen.getByTestId('status-pulse')).toBeInTheDocument()
    expect(screen.getByText('History')).toBeInTheDocument()
  })

  it('calls onClickPulse when clicking History badge', () => {
    const onClickPulse = vi.fn()
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} isGitVault onClickPulse={onClickPulse} />)
    fireEvent.click(screen.getByTestId('status-pulse'))
    expect(onClickPulse).toHaveBeenCalledOnce()
  })

  it('replaces git controls with a missing-Git warning when isGitVault is false', () => {
    render(
      <StatusBar
        noteCount={100}
        modifiedCount={5}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        isGitVault={false}
        onClickPulse={vi.fn()}
        onCommitPush={vi.fn()}
      />
    )

    expect(screen.getByTestId('status-missing-git')).toBeInTheDocument()
    expect(screen.getByText('Git disabled')).toBeInTheDocument()
    expect(screen.queryByTestId('status-pulse')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-commit-push')).not.toBeInTheDocument()
  })

  it('hides all git controls when Git features are disabled globally', () => {
    render(
      <StatusBar
        noteCount={100}
        modifiedCount={5}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        gitFeaturesEnabled={false}
        isGitVault={false}
        onInitializeGit={vi.fn()}
        onClickPulse={vi.fn()}
        onCommitPush={vi.fn()}
      />
    )

    expect(screen.queryByTestId('status-missing-git')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-pulse')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-commit-push')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-changes')).not.toBeInTheDocument()
  })

  it('opens Git setup from the missing-Git warning with mouse and keyboard', () => {
    const onInitializeGit = vi.fn()
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        isGitVault={false}
        onInitializeGit={onInitializeGit}
      />
    )
    const warning = screen.getByTestId('status-missing-git')

    fireEvent.click(warning)
    expect(onInitializeGit).toHaveBeenCalledOnce()

    warning.focus()
    fireEvent.keyDown(warning, { key: 'Enter' })
    expect(onInitializeGit).toHaveBeenCalledTimes(2)
  })

  it('shows Commit button in status bar', () => {
    const onCommitPush = vi.fn()
    render(<StatusBar noteCount={100} modifiedCount={5} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} onCommitPush={onCommitPush} />)
    expect(screen.getByTestId('status-commit-push')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('status-commit-push'))
    expect(onCommitPush).toHaveBeenCalledOnce()
  })

  it('activates the Commit button with the keyboard', () => {
    const onCommitPush = vi.fn()
    render(<StatusBar noteCount={100} modifiedCount={5} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} onCommitPush={onCommitPush} />)
    const commitButton = screen.getByTestId('status-commit-push')
    commitButton.focus()
    fireEvent.keyDown(commitButton, { key: 'Enter' })
    expect(onCommitPush).toHaveBeenCalledOnce()
  })

  it('shows Commit progress feedback and blocks duplicate activation while pending', () => {
    const onCommitPush = vi.fn()
    render(
      <StatusBar
        noteCount={100}
        modifiedCount={5}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        onCommitPush={onCommitPush}
        commitActionPending
      />
    )
    const commitButton = screen.getByTestId('status-commit-push')

    expect(commitButton).toHaveAttribute('aria-busy', 'true')
    expect(commitButton).toHaveAttribute('aria-disabled', 'true')
    expect(commitButton.querySelector('.animate-spin')).not.toBeNull()

    fireEvent.click(commitButton)
    fireEvent.keyDown(commitButton, { key: 'Enter' })
    fireEvent.keyDown(commitButton, { key: ' ' })
    expect(onCommitPush).not.toHaveBeenCalled()
  })

  it('uses a local-only tooltip for the commit button when no remote is configured', async () => {
    render(
      <StatusBar
        noteCount={100}
        modifiedCount={5}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        onCommitPush={vi.fn()}
        remoteStatus={{ branch: 'main', ahead: 0, behind: 0, hasRemote: false }}
      />
    )
    await expectTooltip(screen.getByRole('button', { name: 'Commit changes locally' }), 'Commit changes locally')
  })

  it('shows Commit button even when no modified files', () => {
    render(<StatusBar noteCount={100} modifiedCount={0} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} onCommitPush={vi.fn()} />)
    expect(screen.getByTestId('status-commit-push')).toBeInTheDocument()
  })

  it('hides Commit button when no onCommitPush callback', () => {
    render(<StatusBar noteCount={100} modifiedCount={5} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)
    expect(screen.queryByTestId('status-commit-push')).not.toBeInTheDocument()
  })

  it('does not render the legacy Claude Code badge in the status bar', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)
    expect(screen.queryByTestId('status-claude-code')).not.toBeInTheDocument()
  })

})
