import type { AiAgentPermissionMode } from '../lib/aiAgentPermissionMode'
import type { AiTarget } from '../lib/aiTargets'
import { streamAiAgent, type AgentStreamCallbacks } from './streamAiAgent'
import { streamAiModel } from './streamAiModel'

const TITLE_WORD_LIMIT = 4
const TITLE_CHAR_LIMIT = 48

const TITLE_SYSTEM_PROMPT = [
  'Create a concise title for this chat after reading the user request and assistant answer.',
  'Use 2 to 4 words when possible, and never exceed 48 characters.',
  'Write a noun phrase, not a question and not a sentence.',
  'Describe the chat topic, not the assistant process or result count.',
  'Use sentence case: capitalize only the first word and preserve acronyms.',
  'Do not use quotation marks, markdown, emojis, or trailing punctuation.',
  'Return only the title.',
  'Do not inspect files or use tools.',
].join(' ')

const STOP_WORDS = new Set([
  'a',
  'about',
  'an',
  'and',
  'are',
  'ask',
  'can',
  'could',
  'create',
  'did',
  'do',
  'does',
  'draft',
  'find',
  'for',
  'from',
  'give',
  'help',
  'how',
  'i',
  'into',
  'is',
  'make',
  'me',
  'my',
  'next',
  'please',
  'show',
  'steps',
  'summarize',
  'summary',
  'tell',
  'the',
  'this',
  'that',
  'to',
  'what',
  "what's",
  'whats',
  'when',
  'where',
  'which',
  'who',
  'why',
  'with',
  'you',
  'your',
])

const ANSWER_LIKE_TITLE_PATTERNS = [
  /^(according to|after|based on|here|i\b|i'll|i will|let me|the answer|there|we\b|you\b)/i,
  /\b(i found|i searched|let me check|tool use|mcp tools?)\b/i,
]

const QUESTION_TITLE_PATTERNS = [
  /^(can|could|did|do|does|how|is|are|should|what|when|where|which|who|why|would)\b/i,
  /\?$/,
]

function cleanPrompt({ prompt }: { prompt: string }): string {
  return prompt
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripTitleDecorations({ title }: { title: string }): string {
  return title
    .split('\n')[0]
    .replace(/^#+\s*/, '')
    .replace(/^(chat\s+title|title|summary)\s*[:-]\s*/i, '')
    .replace(/^["'`“”‘’\s]+|["'`“”‘’\s]+$/g, '')
    .replace(/[.!?;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function shouldPreserveWordCase({ word }: { word: string }): boolean {
  return /^[A-Z0-9][A-Z0-9.+#-]{1,}$/.test(word)
    || /^[a-z]+[A-Z]/.test(word)
    || /^[A-Z]+[a-z]+[A-Z]/.test(word)
}

function sentenceCaseWord({ firstWord, word }: { firstWord: boolean; word: string }): string {
  if (shouldPreserveWordCase({ word })) return word

  const lower = word.toLocaleLowerCase()
  if (!firstWord) return lower

  const [first = '', ...rest] = Array.from(lower)
  return `${first.toLocaleUpperCase()}${rest.join('')}`
}

function toSentenceCase({ title }: { title: string }): string {
  let firstWord = true

  return title.replace(/\p{L}[\p{L}\p{N}'’-]*/gu, (word) => {
    const next = sentenceCaseWord({ firstWord, word })
    firstWord = false
    return next
  })
}

function trimTitleLength({ title }: { title: string }): string {
  const words = title.split(/\s+/).filter(Boolean).slice(0, TITLE_WORD_LIMIT)
  let nextTitle = ''

  for (const word of words) {
    const candidate = nextTitle ? `${nextTitle} ${word}` : word
    if (candidate.length > TITLE_CHAR_LIMIT) break
    nextTitle = candidate
  }

  return nextTitle || words[0]?.slice(0, TITLE_CHAR_LIMIT) || ''
}

function titleLooksLikeAnswer({ title }: { title: string }): boolean {
  return ANSWER_LIKE_TITLE_PATTERNS.some((pattern) => pattern.test(title))
}

function titleLooksLikeQuestion({ title }: { title: string }): boolean {
  return QUESTION_TITLE_PATTERNS.some((pattern) => pattern.test(title))
}

export function normalizeAiConversationTitle(title: string): string | null {
  const decoratedTitle = stripTitleDecorations({ title })
  if (titleLooksLikeAnswer({ title: decoratedTitle }) || titleLooksLikeQuestion({ title: decoratedTitle })) return null

  const cleanTitle = trimTitleLength({ title: decoratedTitle })
  if (!cleanTitle) return null

  return toSentenceCase({ title: cleanTitle })
}

export function generateAiConversationTitle(prompt: string): string | null {
  const words = cleanPrompt({ prompt })
    .split(' ')
    .map((word) => word.trim())
    .filter(Boolean)
  const meaningfulWords = words.filter((word) => !STOP_WORDS.has(word.toLowerCase()))
  const titleWords = (meaningfulWords.length > 0 ? meaningfulWords : words).slice(0, TITLE_WORD_LIMIT)
  if (titleWords.length === 0) return null

  return normalizeAiConversationTitle(titleWords.join(' '))
}

export interface GenerateAiConversationTitleRequest {
  assistantResponse?: string
  permissionMode: AiAgentPermissionMode
  prompt: string
  target: AiTarget
  targetReady: boolean
  vaultPath: string
  vaultPaths?: string[]
}

function titlePrompt({ assistantResponse, prompt }: Pick<GenerateAiConversationTitleRequest, 'assistantResponse' | 'prompt'>): string {
  return [
    'Create a short title for this chat.',
    '',
    'Examples:',
    'User request: What is my longest essay?',
    'Assistant answer: The longest essay is Culture at 4,210 words.',
    'Title: Longest essay',
    '',
    'User request: Draft a launch plan for the new site',
    'Assistant answer: Here is a launch plan with owners and milestones.',
    'Title: Launch plan',
    '',
    'User request:',
    prompt.trim(),
    '',
    ...(assistantResponse?.trim()
      ? ['Assistant answer:', assistantResponse.trim(), '']
      : []),
    'Title:',
  ].join('\n')
}

function createTitleStreamCallbacks(onText: (text: string) => void): AgentStreamCallbacks {
  return {
    onText,
    onThinking: () => {},
    onToolStart: () => {},
    onToolDone: () => {},
    onError: () => {},
    onDone: () => {},
  }
}

async function generateAiTitleText(request: GenerateAiConversationTitleRequest): Promise<string | null> {
  let title = ''
  const callbacks = createTitleStreamCallbacks((text) => {
    title += text
  })

  if (request.target.kind === 'api_model') {
    await streamAiModel({
      provider: request.target.provider,
      model: request.target.model,
      message: titlePrompt(request),
      systemPrompt: TITLE_SYSTEM_PROMPT,
      callbacks,
    })
    return normalizeAiConversationTitle(title)
  }

  await streamAiAgent({
    agent: request.target.agent,
    message: titlePrompt(request),
    systemPrompt: TITLE_SYSTEM_PROMPT,
    vaultPath: request.vaultPath,
    vaultPaths: request.vaultPaths,
    permissionMode: request.permissionMode,
    callbacks,
  })
  return normalizeAiConversationTitle(title)
}

export async function generateAiConversationTitleForTarget(
  request: GenerateAiConversationTitleRequest,
): Promise<string | null> {
  const fallbackTitle = generateAiConversationTitle(request.prompt)
  if (!request.targetReady || !request.vaultPath.trim()) return fallbackTitle

  try {
    return await generateAiTitleText(request) ?? fallbackTitle
  } catch {
    return fallbackTitle
  }
}
