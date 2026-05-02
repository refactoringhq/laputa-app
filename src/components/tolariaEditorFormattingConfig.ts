import { filterSuggestionItems } from '@blocknote/core/extensions'
import {
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from '@blocknote/react'
import { createElement, type ReactElement } from 'react'
import {
  CodeBlock,
  File,
  ImageSquare,
  ListBullets,
  ListChecks,
  ListNumbers,
  Minus,
  Paragraph,
  Quotes,
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

type TolariaSlashMenuItem = DefaultReactSuggestionItem & { key: string }
type TolariaBlockTypeSelectItem = {
  name: string
  type: string
  props?: Record<string, boolean | number | string>
  icon: PhosphorIcon
}

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
  numbered_list: ListNumbers,
  paragraph: Paragraph,
  quote: Quotes,
  table: Table,
  toggle_heading: TextHOne,
  toggle_heading_2: TextHTwo,
  toggle_heading_3: TextHThree,
  toggle_list: ListBullets,
  video: Video,
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
  return filterSuggestionItems(
    filterTolariaSlashMenuItems(
      getDefaultReactSlashMenuItems(editor) as TolariaSlashMenuItem[],
    ),
    query,
  )
}
