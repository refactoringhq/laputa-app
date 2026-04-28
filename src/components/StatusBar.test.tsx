import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { StatusBar } from './StatusBar'
import { StatusBarPrimarySection } from './status-bar/StatusBarSections'
import type { VaultOption } from './StatusBar'
vi.mock('../utils/url', async () => {
  const actual = await vi.importActual('../utils/url')
  return { ...actual, openExternalUrl: vi.fn().mockResolvedValue(undefined) }
})

const { openExternalUrl } = await import('../utils/url') as typeof import('../utils/url') & { openExternalUrl: ReturnType<typeof vi.fn> }

const vaults: VaultOption[] = [
  { label: 'Main Vault', path: '/Users/luca/Laputa' },
  { label: 'Work Vault', path: '/Users/luca/Work' },
]

const installedAiAgentsStatus = {
  claude_code: { status: 'installed' as const, version: '1.0.20' },
  codex: { status: 'installed' as const, version: '0.37.0' },
  opencode: { status: 'installed' as const, version: '0.3.1' },
  pi: { status: 'installed' as const, version: '0.70.2' },
}

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
      claudeCodeStatus="missing"
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
  })

  it('does not display branch name', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)
    expect(screen.queryByText('main')).not.toBeInTheDocument()
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

  it('calls onSwitchVault when selecting a different vault', () => {
    const onSwitchVault = vi.fn()
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={onSwitchVault} />)

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    // Click "Work Vault"
    fireEvent.click(screen.getByText('Work Vault'))

    expect(onSwitchVault).toHaveBeenCalledWith('/Users/luca/Work')
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
    expect(item.className).toContain('pr-7')
    expect(removeAction.className).toContain('absolute')
    expect(removeAction.className).toContain('right-1')
    expect(removeAction.className).toContain('group-hover:opacity-100')
    expect(removeAction.className).toContain('group-focus-within:opacity-100')
    expect(removeAction.className).toContain('pointer-events-none')
    expect(screen.getByRole('button', { name: 'Remove Work Vault from list' })).toBeInTheDocument()
  })

  it('calls onRemoveVault when clicking the remove action in the vault menu', () => {
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
    setWindowWidth(880)
    renderDenseStatusBar()

    expect(screen.getByTestId('status-bar')).toHaveStyle({
      flexWrap: 'nowrap',
      height: '30px',
    })
    expect(screen.getByTestId('status-commit-push')).toBeInTheDocument()
    expect(screen.getByTestId('status-pulse')).toBeInTheDocument()
    expect(screen.getByTestId('status-feedback')).toBeInTheDocument()
    expect(screen.getByTestId('status-build-number')).toBeInTheDocument()
    expect(screen.getByTestId('status-claude-code')).toBeInTheDocument()
    expect(screen.queryByText('Commit')).not.toBeInTheDocument()
    expect(screen.queryByText('History')).not.toBeInTheDocument()
    expect(screen.queryByText('Contribute')).not.toBeInTheDocument()
    expect(screen.queryByText('No remote')).not.toBeInTheDocument()
    expect(screen.queryByText('MCP')).not.toBeInTheDocument()
    expect(screen.queryByText('b281')).not.toBeInTheDocument()
    expect(screen.queryByText('Claude Code missing')).not.toBeInTheDocument()
  })

  it('hides the active AI agent label in compact status layout', () => {
    setWindowWidth(880)
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        aiAgentsStatus={installedAiAgentsStatus}
        defaultAiAgent="claude_code"
      />
    )

    expect(screen.getByTestId('status-ai-agents')).toBeInTheDocument()
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
    expect(screen.getByTestId('git-status-popup')).toBeInTheDocument()
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText(/2 ahead/)).toBeInTheDocument()
    expect(screen.getByText(/1 behind/)).toBeInTheDocument()
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

  it('shows Claude Code badge when installed', async () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} claudeCodeStatus="installed" claudeCodeVersion="1.0.20" />)
    const badge = screen.getByTestId('status-claude-code')
    expect(badge).toBeInTheDocument()
    expect(screen.getByText('Claude Code')).toBeInTheDocument()
    await expectTooltip(screen.getByRole('button', { name: 'Claude Code 1.0.20' }), 'Claude Code 1.0.20')
  })

  it('shows Claude Code missing badge with warning when missing', async () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} claudeCodeStatus="missing" />)
    const badge = screen.getByTestId('status-claude-code')
    expect(badge).toBeInTheDocument()
    expect(screen.getByText('Claude Code missing')).toBeInTheDocument()
    await expectTooltip(screen.getByRole('button', { name: 'Claude Code not found — click to install' }), 'Claude Code not found — click to install')
  })

  it('opens install URL when clicking missing Claude Code badge', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} claudeCodeStatus="missing" />)
    fireEvent.click(screen.getByTestId('status-claude-code'))
    expect(openExternalUrl).toHaveBeenCalledWith('https://docs.anthropic.com/en/docs/claude-code')
  })

  it('opens install URL on Enter key for missing Claude Code badge', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} claudeCodeStatus="missing" />)
    fireEvent.keyDown(screen.getByTestId('status-claude-code'), { key: 'Enter' })
    expect(openExternalUrl).toHaveBeenCalledWith('https://docs.anthropic.com/en/docs/claude-code')
  })

  it('hides Claude Code badge when status is checking', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} claudeCodeStatus="checking" />)
    expect(screen.queryByTestId('status-claude-code')).not.toBeInTheDocument()
  })

  it('hides Claude Code badge when no claudeCodeStatus prop provided', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)
    expect(screen.queryByTestId('status-claude-code')).not.toBeInTheDocument()
  })

  it('shows the active AI agent directly in the bottom bar', () => {
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        aiAgentsStatus={installedAiAgentsStatus}
        defaultAiAgent="claude_code"
        onSetDefaultAiAgent={vi.fn()}
      />,
    )

    expect(screen.getByTestId('status-ai-agents')).toHaveTextContent('Claude')
  })

  it('opens the AI agent switcher from the keyboard and switches agents', () => {
    const onSetDefaultAiAgent = vi.fn()
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        aiAgentsStatus={installedAiAgentsStatus}
        defaultAiAgent="claude_code"
        onSetDefaultAiAgent={onSetDefaultAiAgent}
      />,
    )

    const trigger = screen.getByTestId('status-ai-agents')
    trigger.focus()
    act(() => {
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    })

    const codexOption = screen.getByRole('menuitemradio', { name: /Codex/ })
    codexOption.focus()
    act(() => {
      fireEvent.keyDown(codexOption, { key: 'Enter' })
    })

    expect(onSetDefaultAiAgent).toHaveBeenCalledWith('codex')
  })

})
