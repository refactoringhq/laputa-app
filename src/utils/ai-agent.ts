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
  permissionMode?: AiAgentPermissionMode
  agent?: AiAgentId
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

const AGENT_SYSTEM_PREAMBLE = `You are working inside Tolaria, a personal knowledge management app.

Notes are markdown files with YAML frontmatter. Standard fields: title, type (aliased is_a), date, tags.
You can edit markdown files in the active vault. Prefer file edit tools for note changes.
Use the provided MCP tools for: full-text search (search_notes), vault orientation (get_vault_context), parsed note reading (get_note), and opening notes in the UI (open_note).

When you create or edit a note, call open_note(path) so the user sees it in Tolaria.
When you mention or reference a note by name, always use [[Note Title]] wikilink syntax so the user can click to open it.
Be concise and helpful. When you've completed a task, briefly summarize what you did.`

export function buildAgentSystemPrompt(options?: string | AgentSystemPromptOptions): string {
  const { vaultContext, permissionMode, agent } = normalizePromptOptions(options)
  const prompt = `${AGENT_SYSTEM_PREAMBLE}\n\n${permissionModeInstructions(permissionMode, agent)}`

  if (!vaultContext) return prompt
  return `${prompt}\n\nVault context:\n${vaultContext}`
}
