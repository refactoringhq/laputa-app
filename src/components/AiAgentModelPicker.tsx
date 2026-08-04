import { Fragment } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { translate, type AppLocale } from '../lib/i18n'
import type { AiAgentId } from '../lib/aiAgents'
import { modelOptionsForAgent, type AiAgentModelCatalog, type AiAgentModelOption } from '../lib/aiAgentModels'
import type { AiTarget } from '../lib/aiTargets'
import type { AiWorkspaceTargetGroups } from './aiWorkspaceTargetGroups'
import { AiAgentIcon } from './AiAgentIcon'

interface AiTargetModelChoice {
  agentId: AiAgentId | null
  modelId: string | null
  target: AiTarget
  value: string
}

interface AiTargetModelPickerProps {
  catalog: AiAgentModelCatalog
  catalogReady: boolean
  disabled: boolean
  groups: AiWorkspaceTargetGroups
  locale: AppLocale
  modelOptions: AiAgentModelOption[]
  onSelectAgentModel: (agentId: AiAgentId, modelId: string) => void
  onSelectTarget: (targetId: string) => void
  selectedModelId: string
  selectedTarget: AiTarget
  side: 'bottom' | 'top'
}

interface SelectedModelPresentation {
  accessibleLabel: string
  label: string
}

type AgentTarget = Extract<AiTarget, { kind: 'agent' }>

function choiceValue(targetId: string, modelId: string | null): string {
  return JSON.stringify([targetId, modelId])
}

function targetModelChoices(
  groups: AiWorkspaceTargetGroups,
  catalog: AiAgentModelCatalog,
  defaultLabel: string,
): AiTargetModelChoice[] {
  const agentChoices = groups.localAgents.flatMap((target) => {
    return modelOptionsForAgent(target.agent, catalog[target.agent] ?? [], defaultLabel).map((model) => ({
      agentId: target.agent,
      modelId: model.id,
      target,
      value: choiceValue(target.id, model.id),
    }))
  })
  const modelChoices = [...groups.localModels, ...groups.apiModels].map((target) => ({
    agentId: null,
    modelId: null,
    target,
    value: choiceValue(target.id, null),
  }))
  return [...agentChoices, ...modelChoices]
}

function DirectTargetGroup({ label, targets }: { label: string; targets: AiTarget[] }) {
  if (targets.length === 0) return null
  return (
    <>
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      {targets.map((target) => (
        <DropdownMenuRadioItem key={target.id} value={choiceValue(target.id, null)}>
          <span className="truncate" title={target.label}>
            {target.label}
          </span>
        </DropdownMenuRadioItem>
      ))}
    </>
  )
}

function selectedModelPresentation(
  locale: AppLocale,
  modelOptions: AiAgentModelOption[],
  selectedModelId: string,
  selectedTarget: AiTarget,
): SelectedModelPresentation {
  if (selectedTarget.kind !== 'agent') {
    return directTargetPresentation(locale, selectedTarget)
  }
  return agentTargetPresentation(locale, modelOptions, selectedModelId, selectedTarget)
}

function directTargetPresentation(locale: AppLocale, target: AiTarget): SelectedModelPresentation {
  return {
    accessibleLabel: `${translate(locale, 'ai.workspace.targetLabel')}: ${target.label}`,
    label: target.shortLabel,
  }
}

function agentTargetPresentation(
  locale: AppLocale,
  modelOptions: AiAgentModelOption[],
  selectedModelId: string,
  selectedTarget: AgentTarget,
): SelectedModelPresentation {
  const selectedModel = modelOptions.find((option) => option.id === selectedModelId)
  const modelLabel = selectedModel?.label ?? translate(locale, 'ai.workspace.modelDefault')
  return {
    accessibleLabel: `${translate(locale, 'ai.workspace.targetLabel')}: ${selectedTarget.label}, ${translate(locale, 'ai.workspace.modelLabel')}: ${modelLabel}`,
    label: selectedModelId ? (selectedModel?.label ?? selectedTarget.shortLabel) : selectedTarget.shortLabel,
  }
}

function isAgentTarget(target: AiTarget): target is AgentTarget {
  return target.kind === 'agent'
}

function AiTargetModelTrigger({
  busy,
  disabled,
  presentation,
  selectedTarget,
}: {
  busy: boolean
  disabled: boolean
  presentation: SelectedModelPresentation
  selectedTarget: AiTarget
}) {
  return (
    <DropdownMenuTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="min-w-0 max-w-full flex-1 !flex-none justify-start gap-1.5 rounded-full px-2 text-[12px] text-muted-foreground hover:text-foreground"
        disabled={disabled}
        aria-label={presentation.accessibleLabel}
        aria-busy={busy}
        title={presentation.accessibleLabel}
        data-testid="ai-workspace-target-trigger"
      >
        {selectedTarget.kind === 'agent' ? <AiAgentIcon agent={selectedTarget.agent} size={14} /> : null}
        <span className="truncate">{presentation.label}</span>
        <CaretDown size={12} className="shrink-0" />
      </Button>
    </DropdownMenuTrigger>
  )
}

function AgentTargetGroup({
  catalog,
  defaultLabel,
  index,
  target,
}: {
  catalog: AiAgentModelCatalog
  defaultLabel: string
  index: number
  target: AgentTarget
}) {
  return (
    <Fragment key={target.id}>
      {index > 0 && <DropdownMenuSeparator />}
      <DropdownMenuLabel className="flex items-center gap-2">
        <AiAgentIcon agent={target.agent} size={16} />
        {target.label}
      </DropdownMenuLabel>
      {modelOptionsForAgent(target.agent, catalog[target.agent] ?? [], defaultLabel).map((model) => (
        <DropdownMenuRadioItem
          key={choiceValue(target.id, model.id)}
          value={choiceValue(target.id, model.id)}
          aria-label={`${target.label}, ${model.label}`}
        >
          <span className="truncate" title={model.label}>
            {model.label}
          </span>
        </DropdownMenuRadioItem>
      ))}
    </Fragment>
  )
}

function AgentTargetGroups({ catalog, defaultLabel, targets }: {
  catalog: AiAgentModelCatalog
  defaultLabel: string
  targets: AiTarget[]
}) {
  return targets.filter(isAgentTarget).map((target, index) => (
    <AgentTargetGroup key={target.id} {...{ catalog, defaultLabel, index, target }} />
  ))
}

function selectTargetModelChoice({
  choices,
  onSelectAgentModel,
  onSelectTarget,
  selectedTargetId,
  value,
}: {
  choices: AiTargetModelChoice[]
  onSelectAgentModel: (agentId: AiAgentId, modelId: string) => void
  onSelectTarget: (targetId: string) => void
  selectedTargetId: string
  value: string
}) {
  const choice = choices.find((candidate) => candidate.value === value)
  if (!choice) return
  if (choice.agentId !== null && choice.modelId !== null) {
    if (choice.target.id !== selectedTargetId) onSelectTarget(choice.target.id)
    onSelectAgentModel(choice.agentId, choice.modelId)
    return
  }
  onSelectTarget(choice.target.id)
}

function selectedChoiceValue(selectedTarget: AiTarget, selectedModelId: string): string {
  const modelId = selectedTarget.kind === 'agent' ? selectedModelId : null
  return choiceValue(selectedTarget.id, modelId)
}

export function AiTargetModelPicker(options: AiTargetModelPickerProps) {
  const {
    catalog,
    catalogReady,
    disabled,
    groups,
    locale,
    modelOptions,
    onSelectAgentModel,
    onSelectTarget,
    selectedModelId,
    selectedTarget,
    side,
  } = options
  const defaultLabel = translate(locale, 'ai.workspace.modelDefault')
  const choices = targetModelChoices(groups, catalog, defaultLabel)
  const presentation = selectedModelPresentation(locale, modelOptions, selectedModelId, selectedTarget)
  const selectedValue = selectedChoiceValue(selectedTarget, selectedModelId)
  const handleChange = (value: string) => {
    selectTargetModelChoice({
    choices,
    onSelectAgentModel,
    onSelectTarget,
    selectedTargetId: selectedTarget.id,
    value,
  })
  }

  return (
    <DropdownMenu>
      <AiTargetModelTrigger
        busy={!catalogReady}
        disabled={disabled || choices.length === 0}
        presentation={presentation}
        selectedTarget={selectedTarget}
      />
      <DropdownMenuContent
        align="start"
        side={side}
        className="max-w-[min(340px,var(--radix-dropdown-menu-content-available-width))] min-w-[220px]"
      >
        <DropdownMenuRadioGroup value={selectedValue} onValueChange={handleChange}>
          <AgentTargetGroups catalog={catalog} defaultLabel={defaultLabel} targets={groups.localAgents} />
          {groups.localAgents.length > 0 && (groups.localModels.length > 0 || groups.apiModels.length > 0) && (
            <DropdownMenuSeparator />
          )}
          <DirectTargetGroup label={translate(locale, 'ai.workspace.targetLocalModels')} targets={groups.localModels} />
          {groups.localModels.length > 0 && groups.apiModels.length > 0 && <DropdownMenuSeparator />}
          <DirectTargetGroup label={translate(locale, 'ai.workspace.targetApiModels')} targets={groups.apiModels} />
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
