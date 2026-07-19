import { createExtension } from '@blocknote/core'
import type { useCreateBlockNote } from '@blocknote/react'
import { trackEvent } from '../lib/telemetry'
import { isMac } from '../utils/platform'
import { createTolariaCodeBlockOptions } from './codeBlockOptions'
import { installCodeBlockLineNumbers } from './codeBlockLineNumbers'

const CODE_BLOCK_TYPE = 'codeBlock'
const PARAGRAPH_TYPE = 'paragraph'
const FENCE_PATTERN = /^```([^\s`]*)$/

type EditorLike = ReturnType<typeof useCreateBlockNote>
type EditorViewLike = NonNullable<EditorLike['prosemirrorView']>
type CodeBlockShortcutPlatform = 'mac' | 'non-mac'
type ShortcutEvent = Pick<
  KeyboardEvent,
  'altKey' | 'code' | 'ctrlKey' | 'isComposing' | 'key' | 'keyCode' | 'metaKey' | 'shiftKey'
>
type RichEditorBlock = {
  content?: unknown
  id: string
  type: string
}
type ShortcutEditor = EditorLike & {
  isEditable?: boolean
  updateBlock: (id: string, update: never) => unknown
}
type CodeBlockCreationSource = 'keyboard_shortcut' | 'markdown_fence'
type CodeBlockCreation = {
  block: RichEditorBlock
  clearContent?: boolean
  editor: ShortcutEditor
  language: string
  source: CodeBlockCreationSource
}

function currentPlatform(): CodeBlockShortcutPlatform {
  return isMac() ? 'mac' : 'non-mac'
}

function hasPlatformCommand(event: ShortcutEvent, platform: CodeBlockShortcutPlatform): boolean {
  return platform === 'mac'
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey
}

export function isCodeBlockCreationShortcut(
  event: ShortcutEvent,
  platform: CodeBlockShortcutPlatform = currentPlatform(),
): boolean {
  return hasPlatformCommand(event, platform)
    && event.shiftKey
    && !event.altKey
    && event.code === 'Backquote'
}

function isSelectAllShortcut(
  event: ShortcutEvent,
  platform: CodeBlockShortcutPlatform = currentPlatform(),
): boolean {
  return hasPlatformCommand(event, platform)
    && !event.shiftKey
    && !event.altKey
    && (event.code === 'KeyA' || event.key.toLowerCase() === 'a')
}

function isComposing(event: ShortcutEvent, view?: EditorViewLike | null): boolean {
  return event.isComposing || event.keyCode === 229 || Boolean(view?.composing)
}

function currentBlock(editor: ShortcutEditor): RichEditorBlock | null {
  try {
    const block = editor.getTextCursorPosition().block
    return block?.id && typeof block.type === 'string' ? block as RichEditorBlock : null
  } catch {
    return null
  }
}

function plainText(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const textParts: string[] = []
  for (const item of content) {
    if (!item || typeof item !== 'object' || !('text' in item) || typeof item.text !== 'string') return null
    textParts.push(item.text)
  }
  return textParts.join('')
}

function resolveLanguage(languageName: string): string {
  const normalized = languageName.trim().toLowerCase()
  if (!normalized) return 'text'
  const languages = createTolariaCodeBlockOptions().supportedLanguages ?? {}
  return Object.entries(languages).find(([id, option]) => (
    id === normalized || option.aliases?.includes(normalized)
  ))?.[0] ?? normalized
}

function fenceLanguage(block: RichEditorBlock): string | null {
  if (block.type !== PARAGRAPH_TYPE) return null
  const match = plainText(block.content)?.match(FENCE_PATTERN)
  return match ? resolveLanguage(match[1] ?? '') : null
}

function turnIntoCodeBlock({
  editor, block, language, source, clearContent = false,
}: CodeBlockCreation): boolean {
  const update = {
    type: CODE_BLOCK_TYPE,
    props: { language },
    ...(clearContent ? { content: [] } : {}),
  }
  editor.updateBlock(block.id, {
    ...update,
  } as never)
  editor.focus()
  trackEvent('editor_code_block_created', { source })
  return true
}

function createFromFence(editor: ShortcutEditor, block: RichEditorBlock): boolean {
  const language = fenceLanguage(block)
  return language ? turnIntoCodeBlock({
    editor, block, language, source: 'markdown_fence', clearContent: true,
  }) : false
}

function createFromShortcut(editor: ShortcutEditor, block: RichEditorBlock): boolean {
  if (block.type === CODE_BLOCK_TYPE) return false
  return turnIntoCodeBlock({ editor, block, language: 'text', source: 'keyboard_shortcut' })
}

function targetCodeElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  return target.closest('[data-content-type="codeBlock"]')?.querySelector<HTMLElement>('pre code') ?? null
}

function selectionCodeElement(target: EventTarget | null): HTMLElement | null {
  const ownerDocument = target instanceof Node ? target.ownerDocument ?? document : document
  const anchor = ownerDocument.getSelection()?.anchorNode
  const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement
  return anchorElement?.closest('[data-content-type="codeBlock"]')
    ?.querySelector<HTMLElement>('pre code') ?? null
}

function selectCodeBlockContents(target: EventTarget | null): boolean {
  const code = targetCodeElement(target) ?? selectionCodeElement(target)
  const selection = code?.ownerDocument.getSelection()
  if (!code || !selection) return false

  const range = code.ownerDocument.createRange()
  range.selectNodeContents(code)
  selection.removeAllRanges()
  selection.addRange(range)
  return true
}

function consume(event: KeyboardEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

function isPlainEnter(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
}

function createFromFenceKey(event: KeyboardEvent, editor: ShortcutEditor, block: RichEditorBlock): boolean {
  return isPlainEnter(event) && createFromFence(editor, block)
}

function createFromShortcutKey(event: KeyboardEvent, editor: ShortcutEditor, block: RichEditorBlock): boolean {
  return isCodeBlockCreationShortcut(event) && createFromShortcut(editor, block)
}

function selectFromCodeBlock(event: KeyboardEvent, block: RichEditorBlock): boolean {
  if (block.type !== CODE_BLOCK_TYPE) return false
  return isSelectAllShortcut(event) && selectCodeBlockContents(event.target)
}

function handleCodeBlockKeyDown(event: KeyboardEvent, editor: ShortcutEditor, view?: EditorViewLike | null): void {
  if (editor.isEditable === false || isComposing(event, view)) return
  const block = currentBlock(editor)
  if (!block) return

  const handled = createFromFenceKey(event, editor, block)
    || createFromShortcutKey(event, editor, block)
    || selectFromCodeBlock(event, block)
  if (handled) consume(event)
}

export const createRichEditorCodeBlockShortcutExtension = createExtension(({ editor }) => {
  const richEditor = editor as ShortcutEditor
  const readView = () => richEditor._tiptapEditor?.view ?? richEditor.prosemirrorView
  const handleKeyDown = (event: KeyboardEvent) => handleCodeBlockKeyDown(event, richEditor, readView())

  return {
    key: 'richEditorCodeBlockShortcuts',
    mount: ({ dom, signal }) => {
      installCodeBlockLineNumbers(dom, signal)
      dom.addEventListener('keydown', handleKeyDown, { capture: true, signal })
    },
  } as const
})
