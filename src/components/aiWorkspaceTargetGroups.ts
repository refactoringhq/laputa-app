import {
  agentTargets,
  configuredModelTargets,
  isLocalAiProvider,
  type AiModelProvider,
  type AiModelTarget,
  type AiTarget,
} from '../lib/aiTargets'
import {
  isAiAgentInstalled,
  type AiAgentsStatus,
} from '../lib/aiAgents'

type AgentTarget = Extract<AiTarget, { kind: 'agent' }>

export interface AiWorkspaceTargetGroups {
  localAgents: AgentTarget[]
  localModels: AiModelTarget[]
  apiModels: AiModelTarget[]
}

export function buildAiWorkspaceTargetGroups(
  statuses: AiAgentsStatus,
  providers: AiModelProvider[] | null | undefined,
): AiWorkspaceTargetGroups {
  const localAgents = agentTargets().filter((target): target is AgentTarget => (
    target.kind === 'agent' && isAiAgentInstalled(statuses, target.agent)
  ))
  const models = configuredModelTargets(providers)

  return {
    localAgents,
    localModels: models.filter((target) => isLocalAiProvider(target.provider)),
    apiModels: models.filter((target) => !isLocalAiProvider(target.provider)),
  }
}
