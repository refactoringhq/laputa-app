import { describe, expect, it } from 'vitest'
import { BlockNoteEditor } from '@blocknote/core'
import { schema } from '../components/editorSchema'
import { preProcessEditorMarkdown, resolveBlocksForTarget } from './editorBlockResolution'

describe('preProcessEditorMarkdown', () => {
  it('prepares currency prose without single-tilde strike or inline math placeholders', () => {
    const markdown = [
      '# Finance',
      '',
      '### 6. Stop new Pro/Business customers from quitting in months 1-2 (~$1.5k/mo now, ~$3k/mo by autumn)',
      '',
      'Monthly subscribers are worth ~$115 lifetime vs ~$223 for old Creator.',
      '',
      'Keep ~~deleted~~ marked.',
    ].join('\n')

    const preprocessed = preProcessEditorMarkdown(markdown)

    expect(preprocessed).toContain('\\~$1.5k/mo now, \\~$3k/mo')
    expect(preprocessed).toContain('\\~$115 lifetime vs \\~$223')
    expect(preprocessed).toContain('~~deleted~~')
    expect(preprocessed).not.toContain('TOLARIA_MATH_INLINE')
  })

  it('renders bare task-list markers as empty checklist blocks', async () => {
    const editor = BlockNoteEditor.create({ schema })
    const content = [
      '> 工作项',
      '',
      '- [ ]',
      '',
      '> 非工作项',
      '',
      '- [ ]',
    ].join('\n')

    const resolved = await resolveBlocksForTarget({
      cache: new Map(),
      content,
      editor,
      targetPath: 'checklist-ui-error.md',
    })
    const checklistBlocks = resolved.blocks.filter(block => block.type === 'checkListItem')

    expect(checklistBlocks).toEqual([
      expect.objectContaining({ content: [], props: expect.objectContaining({ checked: false }) }),
      expect.objectContaining({ content: [], props: expect.objectContaining({ checked: false }) }),
    ])
    expect(resolved.blocks).not.toContainEqual(
      expect.objectContaining({
        content: [expect.objectContaining({ text: '[ ]' })],
        type: 'bulletListItem',
      }),
    )
  })
})
