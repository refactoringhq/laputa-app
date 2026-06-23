import { describe, expect, it, vi } from 'vitest'
import { serializeEditorDocumentToMarkdown, syncActiveTabIntoRawBuffer } from './editorRawModeSync'

function imageEditor(markdown: string) {
  return {
    document: [{ id: 'image-1', type: 'image', props: {}, children: [] }],
    blocksToMarkdownLossy: vi.fn(() => markdown),
  }
}

describe('editorRawModeSync image paths', () => {
  it('serializes vault-local image assets relative to the active note directory', () => {
    const editor = imageEditor('![shot](asset://localhost/%2Fvault%2Fprojects%2Fnotes%2Fimg%2Fshot.png)\n')

    expect(serializeEditorDocumentToMarkdown(
      editor as never,
      '---\ntitle: Project Plan\n---\n',
      '/vault',
      '/vault/projects/notes/plan.md',
    )).toBe('---\ntitle: Project Plan\n---\n![shot](./img/shot.png)\n')
  })

  it('uses activeTabPath when syncing rich editor images into raw mode', () => {
    const rawLatestContentRef = { current: null as string | null }
    const editor = imageEditor('![diagram](asset://localhost/%2Fvault%2Fprojects%2Fshared%2Fdiagram.png)\n')

    const synced = syncActiveTabIntoRawBuffer({
      editor: editor as never,
      activeTabPath: '/vault/projects/notes/plan.md',
      activeTabContent: '---\ntitle: Project Plan\n---\n\n![diagram](../shared/diagram.png)\n',
      rawLatestContentRef,
      vaultPath: '/vault',
    })

    expect(synced).toBe('---\ntitle: Project Plan\n---\n![diagram](../shared/diagram.png)\n')
    expect(rawLatestContentRef.current).toBe(synced)
  })

  it('serializes root attachment image assets relative to nested notes', () => {
    const editor = imageEditor('![shot](asset://localhost/%2Fvault%2Fattachments%2Fshot.png)\n')

    expect(serializeEditorDocumentToMarkdown(
      editor as never,
      '---\ntitle: Project Plan\n---\n',
      '/vault',
      '/vault/projects/notes/plan.md',
    )).toBe('---\ntitle: Project Plan\n---\n![shot](../../attachments/shot.png)\n')
  })
})
