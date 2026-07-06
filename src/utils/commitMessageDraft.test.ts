import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiTarget } from '../lib/aiTargets'
import type { ModifiedFile } from '../types'

const { streamAiModelMock } = vi.hoisted(() => ({
  streamAiModelMock: vi.fn(),
}))

vi.mock('./streamAiModel', () => ({
  streamAiModel: streamAiModelMock,
}))

import {
  generateCommitMessageDraft,
  generateDeterministicCommitMessage,
  normalizeCommitMessageDraft,
} from './commitMessageDraft'

const apiTarget: Extract<AiTarget, { kind: 'api_model' }> = {
  kind: 'api_model',
  id: 'model:openai/gpt-4.1',
  label: 'OpenAI · GPT-4.1',
  shortLabel: 'GPT-4.1',
  provider: {
    id: 'openai',
    name: 'OpenAI',
    kind: 'open_ai',
    api_key_storage: 'env',
    api_key_env_var: 'OPENAI_API_KEY',
    models: [],
  },
  model: {
    id: 'gpt-4.1',
    display_name: 'GPT-4.1',
    capabilities: { streaming: true, tools: false, vision: false, json_mode: false, reasoning: false },
  },
}

const agentTarget: Extract<AiTarget, { kind: 'agent' }> = {
  kind: 'agent',
  agent: 'codex',
  id: 'agent:codex',
  label: 'Codex',
  shortLabel: 'Codex',
}

function file(
  relativePath: string,
  status: ModifiedFile['status'] = 'modified',
  stats: Partial<ModifiedFile> = {},
): ModifiedFile {
  return { path: `/vault/${relativePath}`, relativePath, status, ...stats }
}

describe('commit message draft generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    streamAiModelMock.mockResolvedValue(undefined)
  })

  it('returns an empty deterministic message for an empty diff', () => {
    expect(generateDeterministicCommitMessage([])).toBe('')
  })

  it('uses the existing concise message for small diffs', () => {
    expect(generateDeterministicCommitMessage([
      file('alpha.md'),
      file('beta.md', 'untracked'),
    ])).toBe('Update alpha, beta')
  })

  it('adds common folder scope for larger note diffs', () => {
    expect(generateDeterministicCommitMessage([
      file('docs/a.md'),
      file('docs/b.md'),
      file('docs/c.md'),
      file('docs/d.md'),
    ])).toBe('Update 4 notes in docs')
  })

  it('uses file wording when larger diffs include non-markdown files', () => {
    expect(generateDeterministicCommitMessage([
      file('assets/a.png'),
      file('assets/b.png'),
      file('assets/c.png'),
      file('assets/d.png'),
    ])).toBe('Update 4 files in assets')
  })

  it('normalizes decorated AI output into one commit summary line', () => {
    expect(normalizeCommitMessageDraft('Commit message: Improve onboarding docs.')).toBe('Improve onboarding docs')
  })

  it('uses a ready API model with structured diff metadata and bounded diff excerpts', async () => {
    streamAiModelMock.mockImplementation(async ({ callbacks }) => {
      callbacks.onText('Commit message: Use date casing in old essays.')
      callbacks.onDone()
    })
    const loadFileDiff = vi.fn().mockResolvedValue([
      'diff --git a/essays/old.md b/essays/old.md',
      '--- a/essays/old.md',
      '+++ b/essays/old.md',
      '@@ -1,4 +1,4 @@',
      '-Date: 2026-07-02',
      '+date: 2026-07-02',
    ].join('\n'))

    const result = await generateCommitMessageDraft({
      aiFeaturesEnabled: true,
      files: [
        file('essays/old.md', 'modified', { addedLines: 1, deletedLines: 1 }),
      ],
      loadFileDiff,
      target: apiTarget,
      targetReady: true,
    })

    expect(result).toEqual({
      aiAttempted: true,
      fileCount: 1,
      message: 'Use date casing in old essays',
      source: 'ai_model',
    })
    expect(loadFileDiff).toHaveBeenCalledWith(file('essays/old.md', 'modified', { addedLines: 1, deletedLines: 1 }))
    expect(streamAiModelMock).toHaveBeenCalledWith(expect.objectContaining({
      model: apiTarget.model,
      provider: apiTarget.provider,
      message: expect.stringContaining('+date: 2026-07-02'),
      systemPrompt: expect.stringContaining('Prefer the semantic change over file names'),
    }))
    expect(streamAiModelMock.mock.calls[0][0].message).toContain('-Date: 2026-07-02')
  })

  it('does not call an agent target from the commit-message generator', async () => {
    const result = await generateCommitMessageDraft({
      aiFeaturesEnabled: true,
      files: [file('alpha.md')],
      target: agentTarget,
      targetReady: true,
    })

    expect(result).toEqual({
      aiAttempted: false,
      fileCount: 1,
      message: 'Update alpha',
      source: 'fallback',
    })
    expect(streamAiModelMock).not.toHaveBeenCalled()
  })

  it('falls back when the API model stream fails', async () => {
    streamAiModelMock.mockRejectedValueOnce(new Error('offline'))

    await expect(generateCommitMessageDraft({
      aiFeaturesEnabled: true,
      files: [file('alpha.md')],
      target: apiTarget,
      targetReady: true,
    })).resolves.toEqual({
      aiAttempted: true,
      fileCount: 1,
      message: 'Update alpha',
      source: 'fallback',
    })
  })

  it('limits large AI prompts to a bounded path list', async () => {
    streamAiModelMock.mockImplementation(async ({ callbacks }) => {
      callbacks.onText('Update docs index')
      callbacks.onDone()
    })

    await generateCommitMessageDraft({
      aiFeaturesEnabled: true,
      files: Array.from({ length: 26 }, (_, index) => file(`docs/${index}.md`)),
      target: apiTarget,
      targetReady: true,
    })

    const prompt = streamAiModelMock.mock.calls[0][0].message
    expect(prompt).toContain('- modified docs/23.md')
    expect(prompt).not.toContain('- modified docs/24.md')
    expect(prompt).toContain('- 2 more paths omitted from the prompt')
  })
})
