import { describe, expect, it } from 'vitest'
import {
  blockSelectionAfterDelete,
  collapsedContentOperationBlockIds,
  documentBlockIds,
  selectedDocumentBlocks,
} from './richEditorBlockSelectionDocument'
import type { TolariaBlockNoteEditor } from './tolariaBlockNoteDom'
import { toggleCollapsedHeading } from './tolariaCollapsedSections'
import type { RichEditorBlockSelectionEditor } from './richEditorBlockSelectionTypes'

type FixtureBlock = {
  children?: FixtureBlock[]
  content?: string
  id: string
  props?: { level?: number }
  type: string
}

function editorFor(blocks: FixtureBlock[]) {
  return { document: blocks } as RichEditorBlockSelectionEditor & TolariaBlockNoteEditor
}

describe('rich editor block-selection document helpers', () => {
  it('reads nested document block ids in document order', () => {
    const blocks = [
      {
        id: 'parent',
        type: 'bulletListItem',
        children: [
          { id: 'child', type: 'bulletListItem' },
          { id: 'child', type: 'bulletListItem' },
        ],
      },
      { id: 'next', type: 'paragraph' },
    ]

    expect(documentBlockIds(blocks)).toEqual(['parent', 'child', 'next'])
  })

  it('returns selected nested blocks without including their ancestors', () => {
    const blocks = [
      {
        id: 'parent',
        type: 'bulletListItem',
        children: [{ id: 'child', content: 'Child', type: 'bulletListItem' }],
      },
    ]

    expect(selectedDocumentBlocks(blocks, ['child'])).toEqual([
      { id: 'child', content: 'Child', type: 'bulletListItem' },
    ])
  })

  it('includes hidden collapsed heading content in operations', () => {
    const editor = editorFor([
      { id: 'heading', type: 'heading', props: { level: 2 } },
      { id: 'hidden', type: 'paragraph' },
      { id: 'next', type: 'heading', props: { level: 2 } },
    ])
    toggleCollapsedHeading(editor, 'heading')

    expect(collapsedContentOperationBlockIds(editor, ['heading'])).toEqual(['heading', 'hidden'])
  })

  it('prunes nested collapsed list children when the parent is already selected', () => {
    const editor = editorFor([
      {
        id: 'parent',
        type: 'bulletListItem',
        children: [{ id: 'child', type: 'bulletListItem' }],
      },
      { id: 'next', type: 'paragraph' },
    ])
    toggleCollapsedHeading(editor, 'parent')

    expect(collapsedContentOperationBlockIds(editor, ['parent', 'child'])).toEqual(['parent'])
  })

  it('selects the next surviving block after delete', () => {
    expect(blockSelectionAfterDelete(['two'], ['one', 'two', 'three'])).toEqual(['three'])
    expect(blockSelectionAfterDelete(['three'], ['one', 'two', 'three'])).toEqual(['two'])
  })
})
