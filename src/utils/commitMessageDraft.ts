import type { AiTarget } from '../lib/aiTargets'
import type { ModifiedFile } from '../types'
import { streamAiModel } from './streamAiModel'
import type { AgentStreamCallbacks } from './streamAiAgent'
import { generateCommitMessage } from './commitMessage'

const AI_FILE_LIMIT = 24
const SUMMARY_CHAR_LIMIT = 72

const COMMIT_MESSAGE_SYSTEM_PROMPT = [
  'Draft one concise Git commit message from structured Tolaria vault change metadata.',
  'Use imperative mood and keep the summary under 72 characters.',
  'Return only the commit message.',
  'Do not use markdown, quotes, emojis, bullet points, issue numbers, or trailing punctuation.',
  'Do not mention files or changes that are not present in the metadata.',
  'Do not inspect files or use tools.',
].join(' ')

export type CommitMessageDraftSource = 'ai_model' | 'fallback'

export interface CommitMessageDraftResult {
  aiAttempted: boolean
  fileCount: number
  message: string
  source: CommitMessageDraftSource
}

interface GenerateCommitMessageDraftOptions {
  aiFeaturesEnabled?: boolean
  files: ModifiedFile[]
  target?: AiTarget
  targetReady?: boolean
}

function fileKind(files: ModifiedFile[]): string {
  return files.every((file) => file.relativePath.toLowerCase().endsWith('.md')) ? 'notes' : 'files'
}

function folderName(relativePath: string): string {
  const parts = relativePath.split('/').filter(Boolean)
  if (parts.length <= 1) return ''
  return parts[0]
}

function commonFolder(files: ModifiedFile[]): string {
  const folders = new Set(files.map((file) => folderName(file.relativePath)).filter(Boolean))
  return folders.size === 1 ? [...folders][0] : ''
}

export function generateDeterministicCommitMessage(files: ModifiedFile[]): string {
  const basicMessage = generateCommitMessage(files)
  if (files.length <= 3) return basicMessage

  const folder = commonFolder(files)
  const scope = folder ? ` in ${folder}` : ''
  return basicMessage.replace(/\b(notes|files)$/, `${fileKind(files)}${scope}`)
}

function statusLabel(status: ModifiedFile['status']): string {
  if (status === 'untracked') return 'added'
  return status
}

function lineSummary(file: ModifiedFile): string {
  if (file.binary) return 'binary'

  const added = file.addedLines ?? 0
  const deleted = file.deletedLines ?? 0
  if (added === 0 && deleted === 0) return 'line stats unavailable'
  return `+${added} -${deleted}`
}

function statusCounts(files: ModifiedFile[]): string {
  const counts = new Map<string, number>()
  for (const file of files) {
    const status = statusLabel(file.status)
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([status, count]) => `${count} ${status}`)
    .join(', ')
}

function diffSummaryPrompt(files: ModifiedFile[], fallback: string): string {
  const listedFiles = files.slice(0, AI_FILE_LIMIT)
  const omitted = files.length - listedFiles.length
  const fileLines = listedFiles.map((file) => (
    `- ${statusLabel(file.status)} ${file.relativePath} (${lineSummary(file)})`
  ))

  return [
    'Draft a Git commit message for these Tolaria vault changes.',
    'Use only this metadata; note contents are intentionally not included.',
    '',
    `Fallback draft: ${fallback}`,
    `Changed ${fileKind(files)}: ${files.length}`,
    `Status counts: ${statusCounts(files)}`,
    '',
    'Changed paths:',
    ...fileLines,
    ...(omitted > 0 ? [`- ${omitted} more path${omitted === 1 ? '' : 's'} omitted from the prompt`] : []),
    '',
    'Commit message:',
  ].join('\n')
}

function streamCallbacks(onText: (text: string) => void): AgentStreamCallbacks {
  return {
    onText,
    onThinking: () => {},
    onToolStart: () => {},
    onToolDone: () => {},
    onError: () => {},
    onDone: () => {},
  }
}

function stripDecorations(message: string): string {
  return message
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^[-*]\s*/, '')
    .replace(/^(commit message|message|summary)\s*[:-]\s*/i, '')
    .replace(/^["'`“”‘’\s]+|["'`“”‘’\s]+$/g, '')
    .replace(/[.!?;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim() ?? ''
}

export function normalizeCommitMessageDraft(message: string): string | null {
  const cleaned = stripDecorations(message)
  if (!cleaned) return null
  if (cleaned.length <= SUMMARY_CHAR_LIMIT) return cleaned

  let trimmed = ''
  for (const word of cleaned.split(' ')) {
    const candidate = trimmed ? `${trimmed} ${word}` : word
    if (candidate.length > SUMMARY_CHAR_LIMIT) break
    trimmed = candidate
  }

  return trimmed || cleaned.slice(0, SUMMARY_CHAR_LIMIT).trim()
}

function readyAiModelTarget({
  aiFeaturesEnabled,
  target,
  targetReady,
}: Pick<GenerateCommitMessageDraftOptions, 'aiFeaturesEnabled' | 'target' | 'targetReady'>): Extract<
  AiTarget,
  { kind: 'api_model' }
> | null {
  if (aiFeaturesEnabled !== true || targetReady !== true || target?.kind !== 'api_model') return null
  return target
}

async function generateAiCommitMessage(
  files: ModifiedFile[],
  fallback: string,
  target: Extract<AiTarget, { kind: 'api_model' }>,
): Promise<string | null> {
  let message = ''
  await streamAiModel({
    provider: target.provider,
    model: target.model,
    message: diffSummaryPrompt(files, fallback),
    systemPrompt: COMMIT_MESSAGE_SYSTEM_PROMPT,
    callbacks: streamCallbacks((text) => {
      message += text
    }),
  })
  return normalizeCommitMessageDraft(message)
}

export async function generateCommitMessageDraft({
  aiFeaturesEnabled,
  files,
  target,
  targetReady,
}: GenerateCommitMessageDraftOptions): Promise<CommitMessageDraftResult> {
  const fallback = generateDeterministicCommitMessage(files)
  const fileCount = files.length
  if (!fallback) return { aiAttempted: false, fileCount, message: '', source: 'fallback' }

  const aiTarget = readyAiModelTarget({ aiFeaturesEnabled, target, targetReady })
  if (!aiTarget) {
    return { aiAttempted: false, fileCount, message: fallback, source: 'fallback' }
  }

  try {
    const message = await generateAiCommitMessage(files, fallback, aiTarget)
    if (message) return { aiAttempted: true, fileCount, message, source: 'ai_model' }
  } catch {
    // Fall through to the deterministic draft. Generation should never block committing.
  }

  return { aiAttempted: true, fileCount, message: fallback, source: 'fallback' }
}
