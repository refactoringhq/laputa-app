import { describe, expect, it } from 'vitest'

import { buildAgentSystemPrompt } from './ai-agent'

// --- buildAgentSystemPrompt ---

describe('buildAgentSystemPrompt', () => {
  it('returns preamble when no vault context', () => {
    const prompt = buildAgentSystemPrompt()
    expect(prompt).toContain('working inside Tolaria')
    expect(prompt).toContain('active vault')
    expect(prompt).toContain("vault's AGENTS.md")
    expect(prompt).toContain('Vault Safe mode is active')
    expect(prompt).toContain('not available in Vault Safe')
    expect(prompt).not.toContain('full shell access')
    expect(prompt).not.toContain('Vault context')
  })

  it('appends vault context when provided', () => {
    const prompt = buildAgentSystemPrompt('Recent notes: foo, bar')
    expect(prompt).toContain('working inside Tolaria')
    expect(prompt).toContain('Vault context:')
    expect(prompt).toContain('Recent notes: foo, bar')
  })

  it('points safe-mode agents to bundled Tolaria docs without shell commands', () => {
    const prompt = buildAgentSystemPrompt({ agentDocsPath: '/app/agent-docs' })

    expect(prompt).toContain('/app/agent-docs/index.md')
    expect(prompt).toContain('/app/agent-docs/pages/templates/portent.md')
    expect(prompt).toContain("Portent as Tolaria's default best-practice model")
    expect(prompt).not.toContain('ripgrep')
    expect(prompt).toContain('Prefer bundled docs over guesses')
  })

  it('keeps ripgrep guidance for bundled docs in shell-capable power user mode', () => {
    const prompt = buildAgentSystemPrompt({
      agent: 'codex',
      agentDocsPath: '/app/agent-docs',
      permissionMode: 'power_user',
    })

    expect(prompt).toContain('ripgrep')
    expect(prompt).toContain('Power User mode is active')
  })

  it('allows shell commands in power user mode where supported', () => {
    const prompt = buildAgentSystemPrompt({ agent: 'codex', permissionMode: 'power_user' })
    expect(prompt).toContain('Power User mode is active')
    expect(prompt).toContain('Local shell commands are available')
    expect(prompt).not.toContain('not available in Vault Safe')
  })

  it('does not promise shell execution for Pi power user mode', () => {
    const prompt = buildAgentSystemPrompt({ agent: 'pi', permissionMode: 'power_user' })
    expect(prompt).toContain('Pi currently uses the same conservative Tolaria MCP configuration')
    expect(prompt).not.toContain('Local shell commands are available')
  })

  it('instructs AI to use wikilink syntax', () => {
    const prompt = buildAgentSystemPrompt()
    expect(prompt).toContain('[[')
    expect(prompt).toMatch(/wikilink/i)
  })
})
