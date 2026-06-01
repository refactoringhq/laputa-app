import { Sparkle } from '@phosphor-icons/react'
import { ActionTooltip } from '@/components/ui/action-tooltip'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { APP_COMMAND_IDS, getAppCommandShortcutDisplay } from '../hooks/appCommandCatalog'
import {
  isAiAgentInstalled,
  type AiAgentId,
  type AiAgentsStatus,
} from '../lib/aiAgents'
import {
  resolveAiTarget,
  type AiModelProvider,
  type AiTarget,
} from '../lib/aiTargets'
import { translate, type AppLocale } from '../lib/i18n'
import type { Settings } from '../types'
import { AiAgentIcon } from './AiAgentIcon'

interface AiWorkspaceFloatingButtonProps {
  defaultAgent: AiAgentId
  defaultTarget?: string
  locale?: AppLocale
  providers?: AiModelProvider[]
  statuses: AiAgentsStatus
  updateBannerVisible?: boolean
  onOpen: () => void
}

function selectedTargetForButton({
  defaultAgent,
  defaultTarget,
  providers,
}: Pick<AiWorkspaceFloatingButtonProps, 'defaultAgent' | 'defaultTarget' | 'providers'>): AiTarget {
  return resolveAiTarget({
    default_ai_agent: defaultAgent,
    default_ai_target: defaultTarget,
    ai_model_providers: providers ?? [],
  } as Settings)
}

function FloatingButtonIcon({
  selectedTarget,
  statuses,
}: {
  selectedTarget: AiTarget
  statuses: AiAgentsStatus
}) {
  if (selectedTarget.kind === 'agent' && isAiAgentInstalled(statuses, selectedTarget.agent)) {
    return <AiAgentIcon agent={selectedTarget.agent} size={24} />
  }
  return <Sparkle size={22} weight="regular" />
}

export function AiWorkspaceFloatingButton({
  defaultAgent,
  defaultTarget,
  locale = 'en',
  providers = [],
  statuses,
  updateBannerVisible = false,
  onOpen,
}: AiWorkspaceFloatingButtonProps) {
  const selectedTarget = selectedTargetForButton({ defaultAgent, defaultTarget, providers })
  const label = translate(locale, 'editor.toolbar.openAi')
  const shortcut = getAppCommandShortcutDisplay(APP_COMMAND_IDS.viewToggleAiChat)

  return (
    <ActionTooltip copy={{ label, shortcut }} side="top" align="end" sideOffset={10}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          'fixed right-5 z-30 size-12 rounded-full border border-border bg-background text-foreground shadow-[0_10px_28px_rgba(15,23,42,0.18),0_2px_8px_rgba(15,23,42,0.12)] hover:bg-background hover:text-foreground',
          updateBannerVisible ? 'bottom-[80px]' : 'bottom-11',
        )}
        aria-label={label}
        data-testid="ai-workspace-floating-button"
        onClick={onOpen}
      >
        <span className="flex size-7 items-center justify-center leading-none">
          <FloatingButtonIcon selectedTarget={selectedTarget} statuses={statuses} />
        </span>
      </Button>
    </ActionTooltip>
  )
}
