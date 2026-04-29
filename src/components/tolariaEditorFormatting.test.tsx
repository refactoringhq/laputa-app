import { describe, expect, it } from 'vitest'
import { getFormattingToolbarItems } from '@blocknote/react'
import {
  filterTolariaFormattingToolbarItems,
  filterTolariaSlashMenuItems,
  getTolariaBlockTypeSelectItems,
} from './tolariaEditorFormattingConfig'

describe('tolariaEditorFormatting', () => {
  it('keeps the markdown-safe toolbar controls and block type select', () => {
    const itemKeys = filterTolariaFormattingToolbarItems(
      getFormattingToolbarItems(getTolariaBlockTypeSelectItems()),
    ).map((item) => String(item.key))

    expect(itemKeys).toContain('blockTypeSelect')
    expect(itemKeys).toContain('boldStyleButton')
    expect(itemKeys).toContain('italicStyleButton')
    expect(itemKeys).toContain('strikeStyleButton')
    expect(itemKeys).toContain('createLinkButton')
    expect(itemKeys).toContain('nestBlockButton')
    expect(itemKeys).toContain('unnestBlockButton')

    expect(itemKeys).not.toContain('underlineStyleButton')
    expect(itemKeys).not.toContain('colorStyleButton')
    expect(itemKeys).not.toContain('textAlignLeftButton')
    expect(itemKeys).not.toContain('textAlignCenterButton')
    expect(itemKeys).not.toContain('textAlignRightButton')
  })

  it('returns the audited markdown-safe block types for the toolbar select', () => {
    expect(getTolariaBlockTypeSelectItems()).toEqual([
      expect.objectContaining({ name: 'Paragraph', type: 'paragraph' }),
      expect.objectContaining({ name: 'Heading 1', type: 'heading', props: { level: 1 } }),
      expect.objectContaining({ name: 'Heading 2', type: 'heading', props: { level: 2 } }),
      expect.objectContaining({ name: 'Heading 3', type: 'heading', props: { level: 3 } }),
      expect.objectContaining({ name: 'Heading 4', type: 'heading', props: { level: 4 } }),
      expect.objectContaining({ name: 'Heading 5', type: 'heading', props: { level: 5 } }),
      expect.objectContaining({ name: 'Heading 6', type: 'heading', props: { level: 6 } }),
      expect.objectContaining({ name: 'Quote', type: 'quote' }),
      expect.objectContaining({ name: 'Bullet List', type: 'bulletListItem' }),
      expect.objectContaining({ name: 'Numbered List', type: 'numberedListItem' }),
      expect.objectContaining({ name: 'Checklist', type: 'checkListItem' }),
      expect.objectContaining({ name: 'Code Block', type: 'codeBlock' }),
    ])
  })

  it('filters unsupported toggle slash-menu variants and annotates supported markdown commands', () => {
    type TolariaSlashMenuTestItem = {
      key: string
      title: string
      onItemClick: () => void
      subtext?: string
    }

    const items = filterTolariaSlashMenuItems([
      { key: 'toggle_heading', title: 'Toggle heading', onItemClick: () => {} },
      { key: 'toggle_list', title: 'Toggle list', onItemClick: () => {} },
      { key: 'heading', title: 'Heading', onItemClick: () => {} },
      { key: 'bullet_list', title: 'Bullet List', onItemClick: () => {} },
      { key: 'code_block', title: 'Code Block', onItemClick: () => {} },
      { key: 'math_inline', title: 'Inline math', onItemClick: () => {} },
      { key: 'math_display', title: 'Display math', onItemClick: () => {} },
    ] satisfies TolariaSlashMenuTestItem[])

    expect(items.map((item) => item.key)).toEqual([
      'heading',
      'bullet_list',
      'code_block',
      'math_inline',
      'math_display',
    ])
    expect(items.find((item) => item.key === 'heading')?.subtext).toContain(
      'Markdown-safe heading',
    )
    expect(items.find((item) => item.key === 'bullet_list')?.subtext).toContain(
      'Markdown-safe bullet list',
    )
    expect(items.find((item) => item.key === 'code_block')?.subtext).toContain(
      'Markdown-safe fenced code block',
    )
    // Math subtexts are set by insertMath*Item constructors, not by the filter
    expect(items.find((item) => item.key === 'math_inline')?.subtext).toBeUndefined()
    expect(items.find((item) => item.key === 'math_display')?.subtext).toBeUndefined()
  })
})
