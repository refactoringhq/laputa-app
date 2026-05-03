import { describe, expect, it, vi } from 'vitest'
import { buildAiAgentCommands } from './aiAgentCommands'

describe('buildAiAgentCommands', () => {
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
