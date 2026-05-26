const TITLE_WORD_LIMIT = 4

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'can',
  'could',
  'for',
  'from',
  'help',
  'how',
  'into',
  'make',
  'please',
  'the',
  'this',
  'that',
  'with',
  'you',
])

function cleanPrompt(prompt: string): string {
  return prompt
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toTitleWord(word: string): string {
  if (word.length <= 1) return word.toUpperCase()
  return `${word[0].toUpperCase()}${word.slice(1)}`
}

export function generateAiConversationTitle(prompt: string): string | null {
  const words = cleanPrompt(prompt)
    .split(' ')
    .map((word) => word.trim())
    .filter(Boolean)
  const meaningfulWords = words.filter((word) => !STOP_WORDS.has(word.toLowerCase()))
  const titleWords = (meaningfulWords.length > 0 ? meaningfulWords : words).slice(0, TITLE_WORD_LIMIT)
  if (titleWords.length === 0) return null

  return titleWords.map(toTitleWord).join(' ')
}
