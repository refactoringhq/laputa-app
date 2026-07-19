import { filterSuggestionItems } from '@blocknote/core/extensions'
import {
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from '@blocknote/react'
import { createElement, type ReactElement } from 'react'
import {
  CalendarBlank,
  CalendarDots,
  CodeBlock,
  Clock,
  File,
  FlowArrow,
  ImageSquare,
  ListBullets,
  ListChecks,
  ListNumbers,
  Minus,
  Pi,
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
import { trackEvent } from '../lib/telemetry'
import {
  RICH_EDITOR_BLOCK_TYPE_DEFINITIONS,
  type RichEditorBlockTypeDefinition,
  type RichEditorBlockTypeKey,
} from '../utils/richEditorBlockTypes'
import { HTML_BLOCK_DEFAULT_HEIGHT, HTML_BLOCK_TYPE } from '../utils/htmlBlockMarkdown'
import { MATH_BLOCK_TYPE } from '../utils/mathMarkdown'
import { MERMAID_BLOCK_TYPE, mermaidFenceSource } from '../utils/mermaidMarkdown'
import { TLDRAW_BLOCK_TYPE, TLDRAW_DEFAULT_HEIGHT } from '../utils/tldrawMarkdown'

type TolariaSlashMenuItem = DefaultReactSuggestionItem & { key: string }
type TolariaBlockTypeSelectItem = RichEditorBlockTypeDefinition & {
  icon: PhosphorIcon
}
type SlashInsertEditor = {
  getTextCursorPosition: () => { block: unknown }
  insertInlineContent: (content: string, options: { updateSelection: true }) => void
  replaceBlocks: (blocksToReplace: unknown[], blocksToInsert: Array<Record<string, unknown>>) => void
}
type BlockSlashMenuItemConfig = {
  aliases: string[]
  eventName?: string
  key: string
  props: Record<string, unknown>
  title: string
  type: string
}
type TolariaSlashMenuLabels = {
  dateTitle: string
  datetimeTitle: string
  htmlTitle: string
  mathTitle: string
  timeTitle: string
}
type DateTimeSlashCommandKind = 'date' | 'datetime' | 'time'
type DateTimeSlashMenuLabels = Pick<
  TolariaSlashMenuLabels,
  'dateTitle' | 'datetimeTitle' | 'timeTitle'
>
type DateProvider = () => Date

export const MERMAID_SLASH_COMMAND_DIAGRAM = [
  'flowchart TD',
  '    edit["Switch to the raw editor to edit"]',
].join('\n')
export const MATH_SLASH_COMMAND_LATEX = '\\sqrt{a^2 + b^2}'
export const HTML_SLASH_COMMAND_SOURCE = ''

const UNSUPPORTED_FORMATTING_TOOLBAR_KEYS = new Set([
  'underlineStyleButton',
  'textAlignLeftButton',
  'textAlignCenterButton',
  'textAlignRightButton',
  'colorStyleButton',
])

const UNSUPPORTED_SLASH_MENU_KEYS = new Set([
  'heading_5',
  'heading_6',
  'toggle_heading',
  'toggle_heading_2',
  'toggle_heading_3',
  'toggle_list',
])

const TOLARIA_BLOCK_TYPE_SELECT_ICONS: Record<RichEditorBlockTypeKey, PhosphorIcon> = {
  'bullet-list': ListBullets,
  checklist: ListChecks,
  'code-block': CodeBlock,
  'heading-1': TextHOne,
  'heading-2': TextHTwo,
  'heading-3': TextHThree,
  'heading-4': TextHFour,
  'heading-5': TextHFive,
  'heading-6': TextHSix,
  'numbered-list': ListNumbers,
  paragraph: Paragraph,
  quote: Quotes,
}

const TOLARIA_SLASH_MENU_ICONS: Partial<Record<string, PhosphorIcon>> = {
  audio: SpeakerHigh,
  bullet_list: ListBullets,
  check_list: ListChecks,
  code_block: CodeBlock,
  date: CalendarBlank,
  datetime: CalendarDots,
  divider: Minus,
  emoji: Smiley,
  file: File,
  heading: TextHOne,
  heading_2: TextHTwo,
  heading_3: TextHThree,
  heading_4: TextHFour,
  html: CodeBlock,
  image: ImageSquare,
  math: Pi,
  mermaid: FlowArrow,
  numbered_list: ListNumbers,
  paragraph: Paragraph,
  quote: Quotes,
  table: Table,
  time: Clock,
  toggle_heading: TextHOne,
  toggle_heading_2: TextHTwo,
  toggle_heading_3: TextHThree,
  toggle_list: ListBullets,
  video: Video,
  whiteboard: ScribbleLoop,
}

const DATE_TIME_SLASH_COMMANDS: ReadonlyArray<{
  aliases: string[]
  key: DateTimeSlashCommandKind
  labelKey: keyof DateTimeSlashMenuLabels
}> = [
  { key: 'date', labelKey: 'dateTitle', aliases: ['today'] },
  { key: 'time', labelKey: 'timeTitle', aliases: ['clock'] },
  {
    key: 'datetime',
    labelKey: 'datetimeTitle',
    aliases: ['datetime', 'timestamp', 'date time'],
  },
]

function padDateTimePart(value: number): string {
  return String(value).padStart(2, '0')
}

function formatLocalDateTime(date: Date, kind: DateTimeSlashCommandKind): string {
  const dateValue = [
    date.getFullYear(),
    padDateTimePart(date.getMonth() + 1),
    padDateTimePart(date.getDate()),
  ].join('-')
  const timeValue = [
    padDateTimePart(date.getHours()),
    padDateTimePart(date.getMinutes()),
  ].join(':')

  if (kind === 'date') return dateValue
  if (kind === 'time') return timeValue
  return `${dateValue} ${timeValue}`
}

export function createDateTimeSlashMenuItems(
  editor: Parameters<typeof getDefaultReactSlashMenuItems>[0],
  labels: DateTimeSlashMenuLabels = {
    dateTitle: 'Date',
    datetimeTitle: 'Date and time',
    timeTitle: 'Time',
  },
  getCurrentDate: DateProvider = () => new Date(),
): TolariaSlashMenuItem[] {
  const inlineEditor = editor as unknown as SlashInsertEditor

  return DATE_TIME_SLASH_COMMANDS.map(({ aliases, key, labelKey }) => ({
    aliases,
    key,
    title: labels[labelKey],
    onItemClick: () => {
      inlineEditor.insertInlineContent(formatLocalDateTime(getCurrentDate(), key), {
        updateSelection: true,
      })
      trackEvent('editor_timestamp_slash_command_used', { kind: key })
    },
  } as TolariaSlashMenuItem))
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

export function createMathSlashMenuItem(
  editor: Parameters<typeof getDefaultReactSlashMenuItems>[0],
  labels: Pick<TolariaSlashMenuLabels, 'mathTitle'> = { mathTitle: 'Math' },
): TolariaSlashMenuItem {
  return createBlockSlashMenuItem(editor, {
    key: 'math',
    title: labels.mathTitle,
    aliases: ['equation', 'latex', 'formula', 'sqrt'],
    eventName: 'editor_math_slash_command_used',
    type: MATH_BLOCK_TYPE,
    props: {
      latex: MATH_SLASH_COMMAND_LATEX,
    },
  })
}

export function createHtmlBlockSlashMenuItem(
  editor: Parameters<typeof getDefaultReactSlashMenuItems>[0],
  labels: Pick<TolariaSlashMenuLabels, 'htmlTitle'> = { htmlTitle: 'HTML block' },
): TolariaSlashMenuItem {
  return createBlockSlashMenuItem(editor, {
    key: 'html',
    title: labels.htmlTitle,
    aliases: ['embed', 'iframe', 'sandbox', 'html'],
    eventName: 'editor_html_block_slash_command_used',
    type: HTML_BLOCK_TYPE,
    props: {
      height: HTML_BLOCK_DEFAULT_HEIGHT,
      html: HTML_SLASH_COMMAND_SOURCE,
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
      blockEditor.replaceBlocks([block], [{
        type: config.type,
        props: config.props,
      }])
      if (config.eventName) trackEvent(config.eventName)
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

export function createTolariaSlashMenuIcon(Icon: PhosphorIcon) {
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
  return RICH_EDITOR_BLOCK_TYPE_DEFINITIONS.map((item): TolariaBlockTypeSelectItem => ({
    ...item,
    icon: TOLARIA_BLOCK_TYPE_SELECT_ICONS[item.key],
  }))
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
  labels?: TolariaSlashMenuLabels,
) {
  const defaultItems = getDefaultReactSlashMenuItems(editor) as TolariaSlashMenuItem[]
  const otherGroup = defaultItems.find((item) => item.key === 'emoji')?.group
  const dateTimeItems = createDateTimeSlashMenuItems(editor, labels).map((item) => ({
    ...item,
    group: otherGroup,
  }))
  const items = addItemsToMediaGroup(
    defaultItems,
    [
      createMermaidSlashMenuItem(editor),
      createMathSlashMenuItem(editor, labels),
      createHtmlBlockSlashMenuItem(editor, labels),
      createWhiteboardSlashMenuItem(editor),
      ...dateTimeItems,
    ],
  )

  return filterSuggestionItems(
    filterTolariaSlashMenuItems(
      items,
    ),
    query,
  )
}
