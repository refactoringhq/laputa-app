import { describe, expect, it, vi } from 'vitest'
import { buildAiAgentCommands } from './aiAgentCommands'

describe('buildAiAgentCommands', () => {
  it('exposes GitHub Copilot as an installed switch target', () => {
    const onSetDefaultAiAgent = vi.fn()

    const commands = buildAiAgentCommands({
      aiAgentsStatus: {
        claude_code: { status: 'installed', version: '1.0.20' },
        codex: { status: 'missing', version: null },
        copilot: { status: 'installed', version: '1.0.58' },
        opencode: { status: 'missing', version: null },
        pi: { status: 'missing', version: null },
        antigravity: { status: 'missing', version: null },
        kiro: { status: 'missing', version: null },
        hermes: { status: 'missing', version: null },
      },
      selectedAiAgent: 'claude_code',
      onSetDefaultAiAgent,
    })

    const command = commands.find((item) => item.id === 'switch-ai-agent-copilot')
    expect(command).toMatchObject({
      label: 'Switch AI Agent to GitHub Copilot',
      enabled: true,
    })

    command?.execute()
    expect(onSetDefaultAiAgent).toHaveBeenCalledWith('copilot')
  })

  it('adds a restore guidance command when the vault guidance needs repair', () => {
    const onRestoreVaultAiGuidance = vi.fn()

    const commands = buildAiAgentCommands({
      vaultAiGuidanceStatus: {
        agentsState: 'missing',
        claudeState: 'managed',
        geminiState: 'managed',
        canRestore: true,
      },
      onRestoreVaultAiGuidance,
    })

    const command = commands.find((item) => item.id === 'restore-vault-ai-guidance')
    expect(command).toBeDefined()
    expect(command?.keywords).toContain('antigravity')
    expect(command?.keywords).toContain('gemini')
    command?.execute()
    expect(onRestoreVaultAiGuidance).toHaveBeenCalledOnce()
  })

  it('omits the restore command when the vault guidance is already healthy', () => {
    const commands = buildAiAgentCommands({
      vaultAiGuidanceStatus: {
        agentsState: 'managed',
        claudeState: 'managed',
        geminiState: 'managed',
        canRestore: false,
      },
      onRestoreVaultAiGuidance: vi.fn(),
    })

    expect(commands.find((item) => item.id === 'restore-vault-ai-guidance')).toBeUndefined()
  })
})
