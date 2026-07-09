import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'
import { inferCodeBlockLanguages } from '../utils/codeBlockLanguage'
import { schema } from './editorSchema'

describe('editor schema code block languages', () => {
  it.each([
    ['sql', 'sql'],
    ['powershell', 'powershell'],
    ['ps1', 'powershell'],
    ['vbscript', 'vbscript'],
    ['vb', 'vbscript'],
    ['php', 'php'],
  ])('imports %s fences as %s code blocks and exports the canonical fence', async (fence, language) => {
    const editor = BlockNoteEditor.create({ schema })
    const blocks = await editor.tryParseMarkdownToBlocks([
      `\`\`\`${fence}`,
      'example',
      '```',
    ].join('\n'))
    const repairedBlocks = inferCodeBlockLanguages(blocks) as typeof blocks

    expect(repairedBlocks[0]).toMatchObject({
      type: 'codeBlock',
      props: { language },
    })
    expect(editor.blocksToMarkdownLossy(repairedBlocks)).toContain(`\`\`\`${language}`)
  })
})
