import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { McpSetupDialog } from './McpSetupDialog'

const MANUAL_CONFIG = JSON.stringify({
  mcpServers: {
    tolaria: {
      type: 'stdio',
      command: 'node',
      args: ['/Applications/Tolaria.app/Contents/Resources/mcp-server/index.js'],
      env: {
        VAULT_PATH: '/Users/luca/Laputa',
        WS_UI_PORT: '9711',
      },
    },
  },
}, null, 2)

describe('McpSetupDialog', () => {
  it('renders the explicit setup flow without mutating config by default', () => {
    render(
      <McpSetupDialog
        open={true}
        status="not_installed"
        busyAction={null}
        manualConfigSnippet={MANUAL_CONFIG}
        onClose={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
      />,
    )

    expect(screen.getByText('Set Up External AI Tools')).toBeInTheDocument()
    expect(screen.getByText(/will not touch third-party config files until you confirm here/i)).toBeInTheDocument()
    expect(screen.getByText(/requires Node.js 18\+ on PATH/i)).toBeInTheDocument()
    expect(screen.getByTestId('mcp-config-snippet')).toHaveTextContent('"type": "stdio"')
    expect(screen.getByTestId('mcp-config-snippet')).toHaveTextContent('"VAULT_PATH": "/Users/luca/Laputa"')
    expect(screen.getByTestId('mcp-config-snippet')).toHaveTextContent('"WS_UI_PORT": "9711"')
    expect(screen.getAllByText('~/.claude.json')).toHaveLength(2)
    expect(screen.getByText('~/.claude/mcp.json')).toBeInTheDocument()
    expect(screen.getAllByText('~/.gemini/settings.json')).toHaveLength(2)
    expect(screen.getAllByText('~/.config/mcp/mcp.json')).toHaveLength(2)
    expect(screen.getByText(/picked up by other MCP-compatible tools/i)).toBeInTheDocument()
    expect(screen.getByText(/Gemini CLI needs its own install and sign-in/i)).toBeInTheDocument()
    expect(screen.getByText('GEMINI.md')).toBeInTheDocument()
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
    const onCopyManualConfig = vi.fn()
    const onDisconnect = vi.fn()

    render(
      <McpSetupDialog
        open={true}
        status="installed"
        busyAction={null}
        onClose={onClose}
        onConnect={onConnect}
        onCopyManualConfig={onCopyManualConfig}
        onDisconnect={onDisconnect}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByTestId('mcp-copy-config'))
    fireEvent.click(screen.getByTestId('mcp-setup-connect'))
    fireEvent.click(screen.getByTestId('mcp-setup-disconnect'))

    expect(onClose).toHaveBeenCalledOnce()
    expect(onCopyManualConfig).toHaveBeenCalledOnce()
    expect(onConnect).toHaveBeenCalledOnce()
    expect(onDisconnect).toHaveBeenCalledOnce()
  })

  it('loads exact manual config when opened', () => {
    const onLoadManualConfig = vi.fn()

    render(
      <McpSetupDialog
        open={true}
        status="not_installed"
        busyAction={null}
        onClose={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onLoadManualConfig={onLoadManualConfig}
      />,
    )

    expect(onLoadManualConfig).toHaveBeenCalledOnce()
  })
})
