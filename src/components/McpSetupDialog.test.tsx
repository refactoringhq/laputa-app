import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { McpSetupDialog } from './McpSetupDialog'

describe('McpSetupDialog', () => {
  it('renders the explicit setup flow without mutating config by default', () => {
    render(
      <McpSetupDialog
        open={true}
        status="not_installed"
        busyAction={null}
        onClose={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
      />,
    )

    expect(screen.getByText('Set Up External AI Tools')).toBeInTheDocument()
    expect(screen.getByText(/will not touch third-party config files until you confirm here/i)).toBeInTheDocument()
    expect(screen.getAllByText('~/.claude.json')).toHaveLength(2)
    expect(screen.getByText('~/.claude/mcp.json')).toBeInTheDocument()
    expect(screen.getAllByText('~/.cursor/mcp.json')).toHaveLength(2)
    expect(screen.getAllByText('~/.config/mcp/mcp.json')).toHaveLength(2)
    expect(screen.getAllByText('~/.config/opencode/opencode.json')).toHaveLength(2)
    expect(screen.getByText(/picked up by other MCP-compatible tools/i)).toBeInTheDocument()
    expect(screen.getByTestId('mcp-setup-connect')).toHaveTextContent('Connect External AI Tools')
    expect(screen.queryByTestId('mcp-setup-disconnect')).not.toBeInTheDocument()
  })

  it('renders reconnect and disconnect actions for an already connected vault', () => {
    render(
      <McpSetupDialog
        open={true}
        status="installed"
        busyAction={null}
        onClose={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
      />,
    )

    expect(screen.getByText('Manage External AI Tools')).toBeInTheDocument()
    expect(screen.getByTestId('mcp-setup-connect')).toHaveTextContent('Reconnect External AI Tools')
    expect(screen.getByTestId('mcp-setup-disconnect')).toHaveTextContent('Disconnect')
  })

  it('routes actions through the dialog buttons', () => {
    const onClose = vi.fn()
    const onConnect = vi.fn()
    const onDisconnect = vi.fn()

    render(
      <McpSetupDialog
        open={true}
        status="installed"
        busyAction={null}
        onClose={onClose}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByTestId('mcp-setup-connect'))
    fireEvent.click(screen.getByTestId('mcp-setup-disconnect'))

    expect(onClose).toHaveBeenCalledOnce()
    expect(onConnect).toHaveBeenCalledOnce()
    expect(onDisconnect).toHaveBeenCalledOnce()
  })
})
