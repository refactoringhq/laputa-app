import { filterSuggestionItems } from '@blocknote/core/extensions'
import {
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from '@blocknote/react'
import { createElement, type ReactElement } from 'react'
import {
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  List,
  ListChecks,
  ListOrdered,
  Pilcrow,
  Quote,
  Sigma,
  type LucideIcon,
} from 'lucide-react'

type TolariaSlashMenuItem = DefaultReactSuggestionItem & { key: string }
type TolariaSlashEditor = Parameters<typeof getDefaultReactSlashMenuItems>[0]
interface ProseMirrorTransactionLike {
  insertText(text: string, from?: number, to?: number): ProseMirrorTransactionLike
  scrollIntoView(): ProseMirrorTransactionLike
}

interface ProseMirrorViewLike {
  dispatch(transaction: ProseMirrorTransactionLike): void
  focus?: () => void
  state: {
    selection: {
      from: number
      to: number
      $from: {
        parentOffset: number
        parent: {
          isTextblock: boolean
          textBetween(from: number, to: number, blockSeparator?: string, leafText?: string): string
        }
      }
    }
    tr: ProseMirrorTransactionLike
  }
}

type TolariaSlashEditorWithView = TolariaSlashEditor & {
  _tiptapEditor?: { view?: ProseMirrorViewLike }
  prosemirrorView?: ProseMirrorViewLike
}

type TolariaBlockTypeSelectItem = {
  name: string
  type: string
  props?: Record<string, boolean | number | string>
  icon: LucideIcon
}

const UNSUPPORTED_FORMATTING_TOOLBAR_KEYS = new Set([
  'underlineStyleButton',
  'textAlignLeftButton',
  'textAlignCenterButton',
  'textAlignRightButton',
  'colorStyleButton',
])

const UNSUPPORTED_SLASH_MENU_KEYS = new Set([
  'toggle_heading',
  'toggle_heading_2',
  'toggle_heading_3',
  'toggle_list',
])

const TOLARIA_BLOCK_TYPE_SELECT_ITEMS: TolariaBlockTypeSelectItem[] = [
  { name: 'Paragraph', type: 'paragraph', icon: Pilcrow },
  { name: 'Heading 1', type: 'heading', props: { level: 1 }, icon: Heading1 },
  { name: 'Heading 2', type: 'heading', props: { level: 2 }, icon: Heading2 },
  { name: 'Heading 3', type: 'heading', props: { level: 3 }, icon: Heading3 },
  { name: 'Heading 4', type: 'heading', props: { level: 4 }, icon: Heading4 },
  { name: 'Heading 5', type: 'heading', props: { level: 5 }, icon: Heading5 },
  { name: 'Heading 6', type: 'heading', props: { level: 6 }, icon: Heading6 },
  { name: 'Quote', type: 'quote', icon: Quote },
  { name: 'Bullet List', type: 'bulletListItem', icon: List },
  { name: 'Numbered List', type: 'numberedListItem', icon: ListOrdered },
  { name: 'Checklist', type: 'checkListItem', icon: ListChecks },
  { name: 'Code Block', type: 'codeBlock', icon: Code2 },
]

const TOLARIA_SLASH_MENU_SUPPORT_SUBTEXT: Partial<Record<string, string>> = {
  heading: 'Markdown-safe heading (`#`). Persists after save and note switches.',
  heading_2: 'Markdown-safe heading (`##`). Persists after save and note switches.',
  heading_3: 'Markdown-safe heading (`###`). Persists after save and note switches.',
  heading_4: 'Markdown-safe heading (`####`). Persists after save and note switches.',
  heading_5: 'Markdown-safe heading (`#####`). Persists after save and note switches.',
  heading_6: 'Markdown-safe heading (`######`). Persists after save and note switches.',
  quote: 'Markdown-safe block quote (`>`). Persists after save and note switches.',
  bullet_list: 'Markdown-safe bullet list (`-`). Persists after save and note switches.',
  numbered_list: 'Markdown-safe numbered list (`1.`). Persists after save and note switches.',
  check_list: 'Markdown-safe checklist (`- [ ]`). Persists after save and note switches.',
  paragraph: 'Plain markdown paragraph text. Persists after save and note switches.',
  code_block: 'Markdown-safe fenced code block (```...```). Persists after save and note switches.',
}

function replaceSlashQueryWithMath(editor: TolariaSlashEditor, wrapper: string): boolean {
  const editorWithView = editor as TolariaSlashEditorWithView
  const view = editorWithView._tiptapEditor?.view ?? editorWithView.prosemirrorView
  const selection = view?.state.selection
  if (!view || !selection || selection.from !== selection.to) return false
  if (!selection.$from.parent.isTextblock) return false

  const beforeText = selection.$from.parent.textBetween(0, selection.$from.parentOffset, '', '')
  const slashIndex = beforeText.lastIndexOf('/')
  if (slashIndex === -1) return false

  const from = selection.from - (beforeText.length - slashIndex)
  view.dispatch(view.state.tr.insertText(wrapper + wrapper, from, selection.from).scrollIntoView())
  view.focus?.()
  focusCursorBetweenMathDelimiters(wrapper)
  return true
}

function focusCursorBetweenMathDelimiters(wrapper: string): void {
  const documentRef = globalThis.document
  if (!documentRef) return

  const inserted = wrapper + wrapper
  const cursorOffset = wrapper.length

  requestAnimationFrame(() => {
    const editorRoot = documentRef.querySelector('.bn-editor')
    if (!editorRoot) return

    const showText = documentRef.defaultView?.NodeFilter.SHOW_TEXT ?? 4
    const walker = documentRef.createTreeWalker(editorRoot, showText)
    let target: Text | null = null
    while (walker.nextNode()) {
      if (walker.currentNode.textContent === inserted) {
        target = walker.currentNode as Text
      }
    }
    if (!target) return

    const range = documentRef.createRange()
    range.setStart(target, cursorOffset)
    range.collapse(true)

    const domSelection = documentRef.getSelection()
    domSelection?.removeAllRanges()
    domSelection?.addRange(range)
  })
}

function insertEditableMath(editor: TolariaSlashEditor, wrapper: string): void {
  if (replaceSlashQueryWithMath(editor, wrapper)) return

  const currentBlock = editor.getTextCursorPosition().block
  const mathSource = { type: 'paragraph' as const, content: wrapper + wrapper }

  if (Array.isArray(currentBlock.content) && currentBlock.content.length <= 1) {
    const updatedBlock = editor.updateBlock(currentBlock, mathSource)
    editor.setTextCursorPosition(updatedBlock, 'end')
    focusCursorBetweenMathDelimiters(wrapper)
    return
  }

  const [insertedBlock] = editor.insertBlocks([mathSource], currentBlock, 'after')
  editor.setTextCursorPosition(insertedBlock, 'end')
  focusCursorBetweenMathDelimiters(wrapper)
}

function insertMathDisplayItem(editor: TolariaSlashEditor): TolariaSlashMenuItem {
  return {
    key: 'math_display',
    title: 'Display math',
    aliases: ['latex', 'equation', 'formula', 'katex', 'math', 'display'],
    group: 'Math',
    icon: createElement(Sigma, { size: 18 }),
    subtext: 'Markdown-safe display math (`$$...$$`) with live KaTeX preview.',
    onItemClick: () => insertEditableMath(editor, '$$'),
  }
}

function insertMathInlineItem(editor: TolariaSlashEditor): TolariaSlashMenuItem {
  return {
    key: 'math_inline',
    title: 'Inline math',
    aliases: ['latex', 'equation', 'formula', 'katex', 'math', 'inline'],
    group: 'Math',
    icon: createElement(Sigma, { size: 18 }),
    subtext: 'Markdown-safe inline math (`$...$`) with live KaTeX preview.',
    onItemClick: () => insertEditableMath(editor, '$'),
  }
}

export function getTolariaBlockTypeSelectItems() {
  return TOLARIA_BLOCK_TYPE_SELECT_ITEMS
}

export function filterTolariaFormattingToolbarItems<T extends ReactElement>(
  items: T[],
): T[] {
  return items.filter(
    (item) => !UNSUPPORTED_FORMATTING_TOOLBAR_KEYS.has(String(item.key)),
  )
}

export function filterTolariaSlashMenuItems<T extends TolariaSlashMenuItem>(
  items: T[],
): T[] {
  return items
    .filter((item) => !UNSUPPORTED_SLASH_MENU_KEYS.has(item.key))
    .map((item) => {
      const tolariaSubtext = TOLARIA_SLASH_MENU_SUPPORT_SUBTEXT[item.key]
      if (!tolariaSubtext) return item
      return {
        ...item,
        subtext: tolariaSubtext,
      }
    }) as T[]
}

export function getTolariaSlashMenuItems(
  editor: Parameters<typeof getDefaultReactSlashMenuItems>[0],
  query: string,
) {
  return filterSuggestionItems(
    filterTolariaSlashMenuItems(
      [
        ...getDefaultReactSlashMenuItems(editor),
        insertMathInlineItem(editor),
        insertMathDisplayItem(editor),
      ] as TolariaSlashMenuItem[],
    ),
    query,
  )
}
