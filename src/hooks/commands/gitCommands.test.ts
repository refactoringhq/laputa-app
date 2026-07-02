import { describe, expect, it, vi } from 'vitest'
import { buildGitCommands } from './gitCommands'

describe('buildGitCommands', () => {
  it('adds a generate commit message command when changed files are available', () => {
    const onGenerateCommitMessage = vi.fn()
    const commands = buildGitCommands({
      modifiedCount: 2,
      canAddRemote: false,
      onCommitPush: vi.fn(),
      onGenerateCommitMessage,
      onSelect: vi.fn(),
    })

    const command = commands.find((candidate) => candidate.id === 'generate-commit-message')
    expect(command).toMatchObject({
      enabled: true,
      group: 'Git',
      label: 'Generate Commit Message from Diff',
    })

    command?.execute()
    expect(onGenerateCommitMessage).toHaveBeenCalledTimes(1)
  })

  it('disables commit-message generation when there are no changed files', () => {
    const commands = buildGitCommands({
      modifiedCount: 0,
      canAddRemote: false,
      onCommitPush: vi.fn(),
      onGenerateCommitMessage: vi.fn(),
      onSelect: vi.fn(),
    })

    expect(commands.find((command) => command.id === 'generate-commit-message')).toMatchObject({
      enabled: false,
    })
  })
})
