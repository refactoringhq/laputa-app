import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { arrayMove } from '@dnd-kit/sortable'
import type { AiAgentId } from '../lib/aiAgents'
import { agentTargets, type AiTarget } from '../lib/aiTargets'
import { translate, type AppLocale } from '../lib/i18n'
import type { AiWorkspaceConversationSetting } from '../types'
import {
  generateAiConversationTitleForTarget,
  type GenerateAiConversationTitleRequest,
} from '../utils/aiConversationTitle'
import type { AiWorkspaceTargetGroups } from './aiWorkspaceTargetGroups'

export interface AiConversation {
  archived: boolean
  hasActivity: boolean
  id: string
  modelId: string | null
  targetId: string
  title: string
  usesDefaultTitle: boolean
  usesDefaultTarget: boolean
}

type ConversationId = AiConversation['id']
type ConversationTitle = AiConversation['title']
type SetConversations = Dispatch<SetStateAction<AiConversation[]>>
type TargetId = AiConversation['targetId']

interface UseConversationsOptions {
  fallbackTarget: AiTarget
  fallbackModelId: string | null
  initialActiveConversationId?: ConversationId
  locale: AppLocale
  onSettingsChange?: (conversations: AiWorkspaceConversationSetting[]) => void
  settings?: AiWorkspaceConversationSetting[] | null
  settingsReady: boolean
}

interface CloseConversationOptions {
  activeId: ConversationId
  fallbackTarget: AiTarget
  fallbackModelId: string | null
  id: ConversationId
  locale: AppLocale
}

let fallbackConversationIdCounter = 0

function randomConversationIdPart(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID().slice(0, 8)

  if (typeof cryptoApi?.getRandomValues === 'function') {
    const values = new Uint32Array(2)
    cryptoApi.getRandomValues(values)
    return Array.from(values, (value) => value.toString(36)).join('').slice(0, 8)
  }

  fallbackConversationIdCounter += 1
  return fallbackConversationIdCounter.toString(36).padStart(4, '0')
}

function nextConversationId(): string {
  return `ai-chat-${Date.now()}-${randomConversationIdPart()}`
}

export function canArchiveConversation(conversation: AiConversation): boolean {
  return conversation.archived || conversation.hasActivity
}

export function flatTargets(groups: AiWorkspaceTargetGroups): AiTarget[] {
  return [...groups.localAgents, ...groups.localModels, ...groups.apiModels]
}

export function firstTarget(
  groups: AiWorkspaceTargetGroups,
  defaultTarget: AiTarget | undefined,
  defaultAgent: AiAgentId,
): AiTarget {
  const targets = flatTargets(groups)
  const selectedDefault = defaultTarget && targets.find((target) => target.id === defaultTarget.id)
  if (selectedDefault) return selectedDefault

  const selectedAgent = targets.find((target) => target.kind === 'agent' && target.agent === defaultAgent)
  if (selectedAgent) return selectedAgent
  return firstAvailableTarget(targets, defaultTarget)
}

function firstAvailableTarget(targets: AiTarget[], defaultTarget: AiTarget | undefined): AiTarget {
  return targets[0] ?? defaultTarget ?? agentTargets()[0]
}

export function resolveTarget(conversation: AiConversation, groups: AiWorkspaceTargetGroups, fallback: AiTarget): AiTarget {
  return flatTargets(groups).find((target) => target.id === conversation.targetId) ?? fallback
}

function createConversation(locale: AppLocale, target: AiTarget, index: number, modelId: string | null): AiConversation {
  return {
    archived: false,
    hasActivity: false,
    id: nextConversationId(),
    modelId,
    targetId: target.id,
    title: defaultConversationTitle(locale, index),
    usesDefaultTitle: true,
    usesDefaultTarget: true,
  }
}

function defaultConversationTitle(locale: AppLocale, index: number): string {
  if (index <= 1) return translate(locale, 'ai.workspace.chatTitle', { index: '' }).trim()
  return translate(locale, 'ai.workspace.chatTitle', { index })
}

function isDefaultConversationTitle(title: string): boolean {
  return /^(AI\s+)?Chat(?:\s+\d+)?$/i.test(title.trim())
}

function defaultConversationTitleIndex(title: string): number {
  const match = title.trim().match(/\d+$/)
  if (!match) return 1
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : 1
}

function conversationFromSetting(
  setting: AiWorkspaceConversationSetting,
  fallbackTarget: AiTarget,
  locale: AppLocale,
): AiConversation | null {
  const id = setting.id.trim()
  const storedTitle = setting.title.trim()
  if (!id || !storedTitle) return null
  const usesDefaultTitle = isDefaultConversationTitle(storedTitle)
  const title = usesDefaultTitle
    ? defaultConversationTitle(locale, defaultConversationTitleIndex(storedTitle))
    : storedTitle

  return {
    archived: setting.archived === true,
    hasActivity: !usesDefaultTitle,
    id,
    modelId: setting.model_id?.trim() || null,
    targetId: setting.target_id?.trim() || fallbackTarget.id,
    title,
    usesDefaultTitle,
    usesDefaultTarget: !setting.target_id,
  }
}

function conversationsFromSettings(
  settings: AiWorkspaceConversationSetting[] | null | undefined,
  fallbackTarget: AiTarget,
  locale: AppLocale,
): AiConversation[] {
  const stored = (settings ?? [])
    .map((setting) => conversationFromSetting(setting, fallbackTarget, locale))
    .filter((conversation): conversation is AiConversation => conversation !== null)
  return stored
}

function conversationsToSettings(conversations: AiConversation[]): AiWorkspaceConversationSetting[] {
  return conversations.map((conversation) => ({
    archived: conversation.archived,
    id: conversation.id,
    model_id: conversation.modelId,
    target_id: conversation.usesDefaultTarget ? null : conversation.targetId,
    title: conversation.title,
  }))
}

export function activeConversationForState(
  conversations: AiConversation[],
  activeId: ConversationId,
  showArchived: boolean,
): AiConversation | undefined {
  const selected = conversations.find((conversation) => conversation.id === activeId)
  if (selected && selected.archived === showArchived) return selected

  return conversations.find((conversation) => conversation.archived === showArchived)
    ?? conversations.find((conversation) => !conversation.archived)
    ?? conversations[0]
}

function appendConversationState(
  current: AiConversation[],
  locale: AppLocale,
  target: AiTarget,
  modelId: string | null,
): { activeId: string; conversations: AiConversation[] } {
  const next = createConversation(locale, target, current.length + 1, modelId)
  return {
    activeId: next.id,
    conversations: [...current, next],
  }
}

function forkConversationState(
  current: AiConversation[],
  locale: AppLocale,
  sourceId: ConversationId,
): { activeId: string; conversations: AiConversation[] } | null {
  const source = current.find((conversation) => conversation.id === sourceId)
  if (!source) return null

  const index = current.length + 1
  const next: AiConversation = {
    archived: false,
    hasActivity: true,
    id: nextConversationId(),
    modelId: source.modelId,
    targetId: source.targetId,
    title: source.usesDefaultTitle ? defaultConversationTitle(locale, index) : source.title,
    usesDefaultTitle: false,
    usesDefaultTarget: source.usesDefaultTarget,
  }

  return {
    activeId: next.id,
    conversations: [...current, next],
  }
}

function archiveConversationState(
  current: AiConversation[],
  id: ConversationId,
): { activeId?: string; conversations: AiConversation[] } {
  const conversations = current.map((conversation) => (
    conversation.id === id ? { ...conversation, archived: true } : conversation
  ))
  const fallback = conversations.find((conversation) => !conversation.archived && conversation.id !== id)
  return { activeId: fallback?.id, conversations }
}

function closeConversationState(
  current: AiConversation[],
  { activeId, fallbackModelId, fallbackTarget, id, locale }: CloseConversationOptions,
): { activeId: string; conversations: AiConversation[] } {
  const closedConversation = current.find((conversation) => conversation.id === id)
  if (!closedConversation) return { activeId, conversations: current }

  const conversations = closedConversation.hasActivity
    ? current.map((conversation) => (
        conversation.id === id ? { ...conversation, archived: true } : conversation
      ))
    : current.filter((conversation) => conversation.id !== id)
  const activeConversation = conversations.find((conversation) => conversation.id === activeId && !conversation.archived)
  if (activeConversation) return { activeId, conversations }

  const fallbackConversation = conversations.find((conversation) => !conversation.archived)
  if (fallbackConversation) return { activeId: fallbackConversation.id, conversations }

  const nextConversation = createConversation(locale, fallbackTarget, conversations.length + 1, fallbackModelId)
  return {
    activeId: nextConversation.id,
    conversations: [...conversations, nextConversation],
  }
}

function restoreConversationState(current: AiConversation[], id: ConversationId): AiConversation[] {
  return current.map((conversation) => (
    conversation.id === id ? { ...conversation, archived: false } : conversation
  ))
}

function retargetConversationState(current: AiConversation[], id: ConversationId, targetId: TargetId): AiConversation[] {
  return current.map((conversation) => (
    conversation.id === id ? { ...conversation, targetId, usesDefaultTarget: false } : conversation
  ))
}

function setConversationModelState(current: AiConversation[], id: ConversationId, modelId: string | null): AiConversation[] {
  return current.map((conversation) => (
    conversation.id === id ? { ...conversation, modelId } : conversation
  ))
}

function reorderConversationState(current: AiConversation[], activeId: ConversationId, overId: ConversationId): AiConversation[] {
  const oldIndex = current.findIndex((conversation) => conversation.id === activeId)
  const newIndex = current.findIndex((conversation) => conversation.id === overId)
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return current

  return arrayMove(current, oldIndex, newIndex)
}

function renameConversationState(current: AiConversation[], id: ConversationId, title: ConversationTitle): AiConversation[] {
  const nextTitle = title.trim()
  if (!nextTitle) return current

  return current.map((conversation) => (
    conversation.id === id ? { ...conversation, title: nextTitle, usesDefaultTitle: false } : conversation
  ))
}

function markConversationActivityState(current: AiConversation[], id: ConversationId): AiConversation[] {
  return current.map((conversation) => (
    conversation.id === id
      ? {
          ...conversation,
          hasActivity: true,
        }
      : conversation
  ))
}

function applyGeneratedConversationTitleState(current: AiConversation[], id: ConversationId, title: ConversationTitle): AiConversation[] {
  const nextTitle = title.trim()
  if (!nextTitle) return current

  return current.map((conversation) => (
    conversation.id === id && conversation.usesDefaultTitle
      ? { ...conversation, hasActivity: true, title: nextTitle, usesDefaultTitle: false }
      : conversation
  ))
}

function updateDefaultConversationTargetState(current: AiConversation[], targetId: TargetId): AiConversation[] {
  return current.map((conversation) => (
    conversation.usesDefaultTarget && conversation.targetId !== targetId
      ? { ...conversation, targetId }
      : conversation
  ))
}

function initialActiveId(conversations: AiConversation[], requestedId: ConversationId | undefined): ConversationId {
  if (conversations.some((conversation) => conversation.id === requestedId)) return requestedId ?? ''
  return conversations[0]?.id ?? ''
}

function useConversationSettingsPersistence({
  conversations,
  onSettingsChange,
  settingsReady,
}: {
  conversations: AiConversation[]
  onSettingsChange?: (conversations: AiWorkspaceConversationSetting[]) => void
  settingsReady: boolean
}) {
  const onSettingsChangeRef = useRef(onSettingsChange)

  useEffect(() => {
    onSettingsChangeRef.current = onSettingsChange
  }, [onSettingsChange])

  useEffect(() => {
    if (!settingsReady) return
    onSettingsChangeRef.current?.(conversationsToSettings(conversations))
  }, [conversations, settingsReady])
}

function useTitleConversationFromAnswer(setConversations: SetConversations) {
  return useCallback((request: GenerateAiConversationTitleRequest & { id: ConversationId }) => {
    void generateAiConversationTitleForTarget(request).then((title) => {
      if (!title) return
      setConversations((current) => applyGeneratedConversationTitleState(current, request.id, title))
    })
  }, [setConversations])
}

function useUpdateDefaultConversationTargets(setConversations: SetConversations) {
  return useCallback((targetId: TargetId) => {
    setConversations((current) => updateDefaultConversationTargetState(current, targetId))
  }, [setConversations])
}

export function useConversations({
  fallbackTarget,
  fallbackModelId,
  initialActiveConversationId,
  locale,
  onSettingsChange,
  settings,
  settingsReady,
}: UseConversationsOptions) {
  const [conversations, setConversations] = useState<AiConversation[]>(() => {
    const stored = conversationsFromSettings(settings, fallbackTarget, locale)
    return stored.length > 0 ? stored : [createConversation(locale, fallbackTarget, 1, fallbackModelId)]
  })
  const [activeId, setActiveId] = useState(() => initialActiveId(conversations, initialActiveConversationId))
  const [showArchived, setShowArchived] = useState(false)

  const addConversation = useCallback((target: AiTarget, modelId: string | null = fallbackModelId) => {
    const next = appendConversationState(conversations, locale, target, modelId)
    setConversations(next.conversations)
    setActiveId(next.activeId)
  }, [conversations, fallbackModelId, locale])

  const forkConversation = useCallback((sourceId: ConversationId) => {
    const next = forkConversationState(conversations, locale, sourceId)
    if (!next) return undefined

    setConversations(next.conversations)
    setActiveId(next.activeId)
    return next.activeId
  }, [conversations, locale])

  const archiveConversation = useCallback((id: ConversationId) => {
    const next = archiveConversationState(conversations, id)
    setConversations(next.conversations)
    if (next.activeId) setActiveId(next.activeId)
  }, [conversations])

  const closeConversation = useCallback((id: ConversationId) => {
    const next = closeConversationState(conversations, { activeId, fallbackModelId, fallbackTarget, id, locale })
    setConversations(next.conversations)
    setActiveId(next.activeId)
  }, [activeId, conversations, fallbackModelId, fallbackTarget, locale])

  const restoreConversation = useCallback((id: ConversationId) => {
    setConversations((current) => restoreConversationState(current, id))
    setActiveId(id)
    setShowArchived(false)
  }, [])

  const reorderConversation = useCallback((activeId: ConversationId, overId: ConversationId) => {
    setConversations((current) => reorderConversationState(current, activeId, overId))
  }, [])

  const setConversationTarget = useCallback((id: ConversationId, targetId: TargetId) => {
    setConversations((current) => retargetConversationState(current, id, targetId))
  }, [])

  const setConversationModel = useCallback((id: ConversationId, modelId: string | null) => {
    setConversations((current) => setConversationModelState(current, id, modelId))
  }, [])

  const renameConversation = useCallback((id: ConversationId, title: ConversationTitle) => {
    setConversations((current) => renameConversationState(current, id, title))
  }, [])

  const markConversationActivity = useCallback((id: ConversationId) => {
    setConversations((current) => markConversationActivityState(current, id))
  }, [])

  const titleConversationFromAnswer = useTitleConversationFromAnswer(setConversations)
  const updateDefaultConversationTargets = useUpdateDefaultConversationTargets(setConversations)
  useConversationSettingsPersistence({ conversations, onSettingsChange, settingsReady })

  return {
    activeId, addConversation, archiveConversation, closeConversation, conversations, forkConversation,
    markConversationActivity, renameConversation, reorderConversation, restoreConversation, setActiveId,
    setConversationModel, setConversationTarget, setShowArchived, showArchived, titleConversationFromAnswer, updateDefaultConversationTargets,
  }
}
