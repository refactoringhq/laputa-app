import { createTranslator, type AppLocale, type TranslationKey } from '../lib/i18n'

export type RichEditorBlockTypeKey =
  | 'paragraph'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'quote'
  | 'bullet-list'
  | 'numbered-list'
  | 'checklist'
  | 'code-block'

export type RichEditorBlockTypeDefinition = {
  key: RichEditorBlockTypeKey
  labelKey: TranslationKey
  name: string
  props?: Record<string, boolean | number | string>
  type: string
}

export const RICH_EDITOR_BLOCK_TYPE_DEFINITIONS: RichEditorBlockTypeDefinition[] = [
  {
    key: 'paragraph',
    labelKey: 'editor.blockType.paragraph',
    name: 'Paragraph',
    type: 'paragraph',
  },
  {
    key: 'heading-1',
    labelKey: 'editor.blockType.heading1',
    name: 'Heading 1',
    props: { level: 1 },
    type: 'heading',
  },
  {
    key: 'heading-2',
    labelKey: 'editor.blockType.heading2',
    name: 'Heading 2',
    props: { level: 2 },
    type: 'heading',
  },
  {
    key: 'heading-3',
    labelKey: 'editor.blockType.heading3',
    name: 'Heading 3',
    props: { level: 3 },
    type: 'heading',
  },
  {
    key: 'heading-4',
    labelKey: 'editor.blockType.heading4',
    name: 'Heading 4',
    props: { level: 4 },
    type: 'heading',
  },
  {
    key: 'heading-5',
    labelKey: 'editor.blockType.heading5',
    name: 'Heading 5',
    props: { level: 5 },
    type: 'heading',
  },
  {
    key: 'heading-6',
    labelKey: 'editor.blockType.heading6',
    name: 'Heading 6',
    props: { level: 6 },
    type: 'heading',
  },
  {
    key: 'quote',
    labelKey: 'editor.blockType.quote',
    name: 'Quote',
    type: 'quote',
  },
  {
    key: 'bullet-list',
    labelKey: 'editor.blockType.bulletList',
    name: 'Bullet List',
    type: 'bulletListItem',
  },
  {
    key: 'numbered-list',
    labelKey: 'editor.blockType.numberedList',
    name: 'Numbered List',
    type: 'numberedListItem',
  },
  {
    key: 'checklist',
    labelKey: 'editor.blockType.checklist',
    name: 'Checklist',
    type: 'checkListItem',
  },
  {
    key: 'code-block',
    labelKey: 'editor.blockType.codeBlock',
    name: 'Code Block',
    type: 'codeBlock',
  },
]

export function richEditorBlockTypeName(
  locale: AppLocale,
  blockType: Pick<RichEditorBlockTypeDefinition, 'labelKey' | 'name'>,
): string {
  const translated = createTranslator(locale)(blockType.labelKey)
  return translated === blockType.labelKey ? blockType.name : translated
}
