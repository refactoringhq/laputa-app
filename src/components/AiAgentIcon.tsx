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

const AI_AGENT_ICON_SOURCES: Record<AiAgentId, string> = {
  claude_code: '/ai-agent-icons/claude-code.svg',
  codex: '/ai-agent-icons/codex.svg',
  opencode: '/ai-agent-icons/opencode.svg',
  pi: '/ai-agent-icons/pi.svg',
  gemini: '/ai-agent-icons/gemini.svg',
  kiro: '/ai-agent-icons/kiro.svg',
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
      role={title ? 'img' : undefined}
      aria-label={title ? label : undefined}
      aria-hidden={title ? undefined : true}
    >
      <img
        src={AI_AGENT_ICON_SOURCES[agent]}
        alt=""
        draggable={false}
        width={size}
        height={size}
        style={{ display: 'block', width: size, height: size, objectFit: 'contain' }}
      />
    </span>
  )
}
