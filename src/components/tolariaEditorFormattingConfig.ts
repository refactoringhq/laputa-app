import { filterSuggestionItems } from '@blocknote/core/extensions'
import {
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from '@blocknote/react'
import { createElement, type ReactElement } from 'react'
import {
  CodeBlock,
  File,
  FlowArrow,
  ImageSquare,
  ListBullets,
  ListChecks,
  ListNumbers,
  Minus,
  Paragraph,
  Quotes,
  ScribbleLoop,
  Smiley,
  SpeakerHigh,
  Table,
  TextHOne,
  TextHTwo,
  TextHThree,
  TextHFour,
  TextHFive,
  TextHSix,
  Video,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react'
import { MERMAID_BLOCK_TYPE, mermaidFenceSource } from '../utils/mermaidMarkdown'
import { TLDRAW_BLOCK_TYPE, TLDRAW_DEFAULT_HEIGHT } from '../utils/tldrawMarkdown'

type TolariaSlashMenuItem = DefaultReactSuggestionItem & { key: string }
type TolariaBlockTypeSelectItem = {
  name: string
  type: string
  props?: Record<string, boolean | number | string>
  icon: PhosphorIcon
}
type SlashInsertEditor = {
  getTextCursorPosition: () => { block: unknown }
  updateBlock: (block: unknown, update: Record<string, unknown>) => void
}
type BlockSlashMenuItemConfig = {
  aliases: string[]
  key: string
  props: Record<string, unknown>
  title: string
  type: string
}

export const MERMAID_SLASH_COMMAND_DIAGRAM = [
  'flowchart TD',
  '    edit["Switch to the raw editor to edit"]',
].join('\n')

const UNSUPPORTED_FORMATTING_TOOLBAR_KEYS = new Set([
  'underlineStyleButton',
  'textAlignLeftButton',
  'textAlignCenterButton',
  'textAlignRightButton',
  'colorStyleButton',
])

const UNSUPPORTED_SLASH_MENU_KEYS = new Set([
  'heading_4',
  'heading_5',
  'heading_6',
  'toggle_heading',
  'toggle_heading_2',
  'toggle_heading_3',
  'toggle_list',
])

const TOLARIA_BLOCK_TYPE_SELECT_ITEMS: TolariaBlockTypeSelectItem[] = [
  { name: 'Paragraph', type: 'paragraph', icon: Paragraph },
  { name: 'Heading 1', type: 'heading', props: { level: 1 }, icon: TextHOne },
  { name: 'Heading 2', type: 'heading', props: { level: 2 }, icon: TextHTwo },
  { name: 'Heading 3', type: 'heading', props: { level: 3 }, icon: TextHThree },
  { name: 'Heading 4', type: 'heading', props: { level: 4 }, icon: TextHFour },
  { name: 'Heading 5', type: 'heading', props: { level: 5 }, icon: TextHFive },
  { name: 'Heading 6', type: 'heading', props: { level: 6 }, icon: TextHSix },
  { name: 'Quote', type: 'quote', icon: Quotes },
  { name: 'Bullet List', type: 'bulletListItem', icon: ListBullets },
  { name: 'Numbered List', type: 'numberedListItem', icon: ListNumbers },
  { name: 'Checklist', type: 'checkListItem', icon: ListChecks },
  { name: 'Code Block', type: 'codeBlock', icon: CodeBlock },
]

const TOLARIA_SLASH_MENU_ICONS: Partial<Record<string, PhosphorIcon>> = {
  audio: SpeakerHigh,
  bullet_list: ListBullets,
  check_list: ListChecks,
  code_block: CodeBlock,
  divider: Minus,
  emoji: Smiley,
  file: File,
  heading: TextHOne,
  heading_2: TextHTwo,
  heading_3: TextHThree,
  image: ImageSquare,
  mermaid: FlowArrow,
  numbered_list: ListNumbers,
  paragraph: Paragraph,
  quote: Quotes,
  table: Table,
  toggle_heading: TextHOne,
  toggle_heading_2: TextHTwo,
  toggle_heading_3: TextHThree,
  toggle_list: ListBullets,
  video: Video,
  whiteboard: ScribbleLoop,
}

function createBoardId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `whiteboard-${Date.now().toString(36)}`
}

function createWhiteboardSlashMenuItem(
  editor: Parameters<typeof getDefaultReactSlashMenuItems>[0],
): TolariaSlashMenuItem {
  return createBlockSlashMenuItem(editor, {
    key: 'whiteboard',
    title: 'Whiteboard',
    aliases: ['tldraw', 'drawing', 'canvas', 'sketch'],
    type: TLDRAW_BLOCK_TYPE,
    props: {
      boardId: createBoardId(),
      height: TLDRAW_DEFAULT_HEIGHT,
      snapshot: '{}',
      width: '',
    },
  })
}

function createMermaidSlashMenuItem(
  editor: Parameters<typeof getDefaultReactSlashMenuItems>[0],
): TolariaSlashMenuItem {
  return createBlockSlashMenuItem(editor, {
    key: 'mermaid',
    title: 'Mermaid',
    aliases: ['diagram', 'flowchart', 'graph', 'chart'],
    type: MERMAID_BLOCK_TYPE,
    props: {
      diagram: MERMAID_SLASH_COMMAND_DIAGRAM,
      source: mermaidFenceSource({ diagram: MERMAID_SLASH_COMMAND_DIAGRAM }),
    },
  })
}

function createBlockSlashMenuItem(
  editor: Parameters<typeof getDefaultReactSlashMenuItems>[0],
  config: BlockSlashMenuItemConfig,
): TolariaSlashMenuItem {
  const blockEditor = editor as unknown as SlashInsertEditor

  return {
    key: config.key,
    title: config.title,
    aliases: config.aliases,
    group: 'Media',
    onItemClick: () => {
      const block = blockEditor.getTextCursorPosition().block
      blockEditor.updateBlock(block, {
        type: config.type,
        props: config.props,
      })
    },
  } as TolariaSlashMenuItem
}

export function addItemsToMediaGroup(
  items: TolariaSlashMenuItem[],
  mediaItems: TolariaSlashMenuItem[],
): TolariaSlashMenuItem[] {
  const nextItems = [...items]
  const insertIndex = nextItems.findIndex((item) => item.key === 'emoji')

  if (insertIndex === -1) {
    nextItems.push(...mediaItems)
    return nextItems
  }

  nextItems.splice(insertIndex, 0, ...mediaItems)
  return nextItems
}

function createTolariaSlashMenuIcon(Icon: PhosphorIcon) {
  return createElement(
    'span',
    { className: 'tolaria-slash-menu-icon' },
    createElement(Icon, {
      'aria-hidden': true,
      className: 'tolaria-slash-menu-icon__regular',
      size: 18,
      weight: 'regular',
    }),
    createElement(Icon, {
      'aria-hidden': true,
      className: 'tolaria-slash-menu-icon__fill',
      size: 18,
      weight: 'fill',
    }),
  )
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
      const TolariaIcon = TOLARIA_SLASH_MENU_ICONS[item.key]

      return {
        ...item,
        icon: TolariaIcon ? createTolariaSlashMenuIcon(TolariaIcon) : item.icon,
        subtext: undefined,
      }
    }) as T[]
}

export function getTolariaSlashMenuItems(
  editor: Parameters<typeof getDefaultReactSlashMenuItems>[0],
  query: string,
) {
  const items = addItemsToMediaGroup(
    getDefaultReactSlashMenuItems(editor) as TolariaSlashMenuItem[],
    [
      createMermaidSlashMenuItem(editor),
      createWhiteboardSlashMenuItem(editor),
    ],
  )

  return filterSuggestionItems(
    filterTolariaSlashMenuItems(
      items,
    ),
    query,
  )
}
