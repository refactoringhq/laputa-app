import type { AiAgentId } from '../lib/aiAgents'
import type { AiAgentPermissionMode } from '../lib/aiAgentPermissionMode'

/**
 * AI Agent utilities for app-managed CLI agent sessions.
 *
 * App-managed sessions can edit files in the active vault and use Tolaria-specific
 * MCP tools (search_notes, get_vault_context, get_note, open_note).
 * The frontend receives streaming events for text, tool calls, and completion.
 */

// --- Agent system prompt ---

interface AgentSystemPromptOptions {
  vaultContext?: string
  agentDocsPath?: string
  permissionMode?: AiAgentPermissionMode
  agent?: AiAgentId
  vaultPaths?: string[]
}

function normalizePromptOptions(
  options?: string | AgentSystemPromptOptions,
): AgentSystemPromptOptions {
  return typeof options === 'string' ? { vaultContext: options } : options ?? {}
}

function permissionModeInstructions(
  mode: AiAgentPermissionMode = 'safe',
  agent?: AiAgentId,
): string {
  if (mode === 'power_user') {
    if (agent === 'pi') {
      return `Power User mode is selected, but Pi currently uses the same conservative Tolaria MCP configuration in both modes. Do not promise shell execution unless the Pi CLI exposes it directly in this run.`
    }

    return `Power User mode is active. Local shell commands are available for this vault where the selected CLI agent supports them. Keep commands scoped to the active vault, avoid destructive commands unless explicitly requested, and do not expose note content unnecessarily.`
  }

  return `Vault Safe mode is active. Do not use shell, terminal, Bash, Python/Node script execution, git, or command-line tools. If the user asks whether shell commands are available, say they are not available in Vault Safe. Use file/search/edit tools and Tolaria MCP tools instead.`
}

function agentDocsInstructions(
  agentDocsPath: string | undefined,
  canUseShell: boolean,
): string {
  if (!agentDocsPath) {
    return `Read the vault's AGENTS.md when one exists before making vault-specific assumptions.`
  }

  const searchInstruction = canUseShell
    ? `Start with ${agentDocsPath}/index.md, then use ripgrep over that folder for specific concepts.`
    : `Start with ${agentDocsPath}/index.md, then use the available file and search tools for specific concepts.`

  return `Read the vault's AGENTS.md when one exists before making vault-specific assumptions.
For Tolaria product behavior, workflows, and user questions about how Tolaria works, search the bundled local docs at:
${agentDocsPath}

${searchInstruction} Prefer bundled docs over guesses for Tolaria behavior.

When the user asks how to improve a knowledge base, make it better organized, choose better types, model relationships, or make the vault easier for humans and agents to use, treat Portent as Tolaria's default best-practice model. Read ${agentDocsPath}/pages/templates/portent.md and combine it with Tolaria concepts for types, relationships, properties, Inbox, archive, and custom views.`
}

function vaultScopeInstructions(vaultPaths?: string[]): string {
  const roots = (vaultPaths ?? []).map((path) => path.trim()).filter(Boolean)
  if (roots.length <= 1) {
    return `You can edit markdown files in the active vault. Keep file operations scoped to that vault unless the user explicitly gives another path.`
  }

  return [
    `Multiple Tolaria vaults are active. You can read and edit markdown files in these vault roots:`,
    roots.map((path) => `- ${path}`).join('\n'),
    `When using Tolaria MCP tools, pass the target vault path when a relative note path could be ambiguous.`,
  ].join('\n')
}

const AGENT_SYSTEM_PREAMBLE = `You are working inside Tolaria, a local-first Markdown knowledge base.

Notes are Markdown files with YAML frontmatter. Organization is primarily expressed through H1 titles, types, properties, wikilinks, and relationships, not folder structure.
Prefer file edit tools for note changes.
Use the provided MCP tools for: full-text search (search_notes), vault orientation (get_vault_context), parsed note reading (get_note), and opening notes in the UI (open_note).
Use create_note(path, content, vaultPath?) for new Markdown notes when shell writes are unavailable.

When you create or edit a note, call open_note(path) so the user sees it in Tolaria.
When you mention or reference a note by name, always use [[Note Title]] wikilink syntax so the user can click to open it.
Be concise and helpful. When you've completed a task, briefly summarize what you did.`

export function buildAgentSystemPrompt(options?: string | AgentSystemPromptOptions): string {
  const { vaultContext, agentDocsPath, permissionMode, agent, vaultPaths } = normalizePromptOptions(options)
  const canUseShell = permissionMode === 'power_user' && agent !== 'pi'
  const prompt = [
    AGENT_SYSTEM_PREAMBLE,
    vaultScopeInstructions(vaultPaths),
    agentDocsInstructions(agentDocsPath, canUseShell),
    permissionModeInstructions(permissionMode, agent),
  ].join('\n\n')

  if (!vaultContext) return prompt
  return `${prompt}\n\nVault context:\n${vaultContext}`
}
