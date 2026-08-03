import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { getAiAgentDefinition, type AiAgentId } from '../lib/aiAgents'

interface AiAgentIconProps {
  agent: AiAgentId
  className?: string
  size?: number
  title?: string
}

const ICON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: '0 0 auto',
  overflow: 'hidden',
}

const AI_AGENT_ICON_SOURCES: ReadonlyArray<{ agent: AiAgentId; source: string }> = [
  { agent: 'claude_code', source: '/ai-agent-icons/claude-code.svg' },
  { agent: 'codex', source: '/ai-agent-icons/codex.svg' },
  { agent: 'copilot', source: '/ai-agent-icons/copilot.svg' },
  { agent: 'opencode', source: '/ai-agent-icons/opencode.svg' },
  { agent: 'pi', source: '/ai-agent-icons/pi.svg' },
  { agent: 'antigravity', source: '/ai-agent-icons/gemini.svg' },
  { agent: 'kiro', source: '/ai-agent-icons/kiro.svg' },
  { agent: 'hermes', source: '/ai-agent-icons/hermes.svg' },
]

function aiAgentIconSource(agent: AiAgentId): string {
  return AI_AGENT_ICON_SOURCES.find((candidate) => candidate.agent === agent)?.source
    ?? '/ai-agent-icons/codex.svg'
}

export function AiAgentIcon({
  agent,
  className,
  size = 16,
  title,
}: AiAgentIconProps) {
  const label = title ?? getAiAgentDefinition(agent).label

  return (
    <span
      className={cn('rounded-[5px]', className)}
      style={{ ...ICON_STYLE, width: size, height: size }}
      aria-hidden={title ? undefined : true}
    >
      <img
        src={aiAgentIconSource(agent)}
        alt={title ? label : ''}
        draggable={false}
        width={size}
        height={size}
        style={{ display: 'block', width: size, height: size, objectFit: 'contain' }}
      />
    </span>
  )
}
