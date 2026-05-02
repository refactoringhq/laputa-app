import { Children, isValidElement, type ReactElement } from 'react'
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

  it('filters unsupported toggle slash-menu variants and removes command descriptions', () => {
    type TolariaSlashMenuTestItem = {
      key: string
      title: string
      onItemClick: () => void
      subtext?: string
      icon?: ReactElement
    }

    const items = filterTolariaSlashMenuItems([
      { key: 'toggle_heading', title: 'Toggle heading', onItemClick: () => {} },
      { key: 'toggle_list', title: 'Toggle list', onItemClick: () => {} },
      { key: 'heading', title: 'Heading', subtext: 'Default heading copy', onItemClick: () => {} },
      { key: 'bullet_list', title: 'Bullet List', subtext: 'Default list copy', onItemClick: () => {} },
      { key: 'code_block', title: 'Code Block', subtext: 'Default code copy', onItemClick: () => {} },
      { key: 'heading_4', title: 'Heading 4', onItemClick: () => {} },
      { key: 'heading_5', title: 'Heading 5', onItemClick: () => {} },
      { key: 'heading_6', title: 'Heading 6', onItemClick: () => {} },
    ] satisfies TolariaSlashMenuTestItem[])

    expect(items.map((item) => item.key)).toEqual([
      'heading',
      'bullet_list',
      'code_block',
    ])
    expect(items.map((item) => item.subtext)).toEqual([
      undefined,
      undefined,
      undefined,
    ])
  })

  it('wraps slash-menu icons so hover can swap Phosphor weights', () => {
    type TolariaSlashMenuTestItem = {
      key: string
      title: string
      onItemClick: () => void
      icon?: ReactElement
    }

    const items = filterTolariaSlashMenuItems([
      { key: 'heading', title: 'Heading', onItemClick: () => {} },
    ] satisfies TolariaSlashMenuTestItem[])
    const icon = items[0]?.icon

    expect(isValidElement(icon)).toBe(true)
    if (!isValidElement<{ className?: string; children?: ReactElement[] }>(icon)) return

    const iconChildren = Children.toArray(icon.props.children) as Array<
      ReactElement<{ className?: string; weight?: string }>
    >
    expect(icon.props.className).toBe('tolaria-slash-menu-icon')
    expect(iconChildren.map((child) => child.props.className)).toEqual([
      'tolaria-slash-menu-icon__regular',
      'tolaria-slash-menu-icon__fill',
    ])
    expect(iconChildren.map((child) => child.props.weight)).toEqual([
      'regular',
      'fill',
    ])
  })
})
