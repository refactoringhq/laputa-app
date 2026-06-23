import { describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../types'
import type { Tab } from '../hooks/useTabManagement'
import {
  applyPendingRawExitContent,
  rememberPendingRawExitContent,
  resolvePendingRawExitContent,
  resolveRawModeContent,
  syncActiveTabIntoRawBuffer,
} from './editorRawModeSync'

const mockEntry: VaultEntry = {
  path: '/vault/project/test.md',
  filename: 'test.md',
  title: 'Test Project',
  isA: 'Project',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: 'Active',
  archived: false,
  modifiedAt: 1700000000,
  createdAt: null,
  fileSize: 1024,
  snippet: '',
  wordCount: 12,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  template: null,
  sort: null,
  outgoingLinks: [],
  sidebarLabel: null,
  view: null,
  visible: null,
  properties: {},
  organized: false,
  favorite: false,
  favoriteIndex: null,
  listPropertiesDisplay: [],
  hasH1: false,
}

const mockContent = `---
title: Test Project
is_a: Project
Status: Active
---

# Test Project

This is a test note with some words to count.
`
const normalizedContent = '---\ntitle: Test Project\nis_a: Project\nStatus: Active\n---\n# Test Project\n\nThis is a test note with some words to count.\n'

const mockTab: Tab = { entry: mockEntry, content: mockContent }
const otherTab: Tab = {
  entry: { ...mockEntry, path: '/vault/other.md', filename: 'other.md', title: 'Other Note' },
  content: '# Other\n',
}

const mockEditor = {
  document: [{ id: '1', type: 'paragraph', content: [], props: {}, children: [] }],
  blocksToMarkdownLossy: vi.fn(() => '# Test Project\n\nThis is a test note with some words to count.\n'),
}

function rememberRawExit(current: string, onContentChange = vi.fn()) {
  return {
    onContentChange,
    result: rememberPendingRawExitContent({
      activeTabPath: mockEntry.path,
      activeTabContent: mockContent,
      rawInitialContent: normalizedContent,
      rawLatestContentRef: { current },
      onContentChange,
    }),
  }
}

describe('applyPendingRawExitContent', () => {
  it('overrides only the matching tab when raw content is newer than tab state', () => {
    const pending = {
      path: mockEntry.path,
      content: '---\ntype: Note\nstatus: Active\n---\n| Head 1 | Head 2 | Head 3 |\n| --- | --- | --- |\n| A | B | C |\n',
    }

    const result = applyPendingRawExitContent([mockTab, otherTab], pending)

    expect(result[0]).toEqual({ ...mockTab, content: pending.content })
    expect(result[1]).toBe(otherTab)
  })

  it('returns the original tabs array when the pending raw content is already synced', () => {
    const tabs = [mockTab, otherTab]
    const pending = { path: mockEntry.path, content: mockContent }

    expect(applyPendingRawExitContent(tabs, pending)).toBe(tabs)
  })
})

describe('raw-mode sync content guards', () => {
  it('does not emit a content change when entering raw mode normalizes markdown', () => {
    const onContentChange = vi.fn()
    const rawLatestContentRef = { current: null as string | null }

    const result = syncActiveTabIntoRawBuffer({
      editor: mockEditor as never,
      activeTabPath: mockEntry.path,
      activeTabContent: mockContent,
      rawLatestContentRef,
    })

    expect(result).toBe('---\ntitle: Test Project\nis_a: Project\nStatus: Active\n---\n# Test Project\n\nThis is a test note with some words to count.\n')
    expect(rawLatestContentRef.current).toBe(result)
    expect(onContentChange).not.toHaveBeenCalled()
  })

  it('captures the latest serialized markdown when entering raw mode', () => {
    const rawLatestContentRef = { current: null as string | null }
    mockEditor.blocksToMarkdownLossy.mockReturnValueOnce('# Test Project\n\nUpdated body\n')

    const result = syncActiveTabIntoRawBuffer({
      editor: mockEditor as never,
      activeTabPath: mockEntry.path,
      activeTabContent: mockContent,
      rawLatestContentRef,
    })

    expect(result).toBe('---\ntitle: Test Project\nis_a: Project\nStatus: Active\n---\n# Test Project\n\nUpdated body\n')
    expect(rawLatestContentRef.current).toBe(result)
  })

  it('keeps raw-mode serialization note-relative for vault attachment images', () => {
    const rawLatestContentRef = { current: null as string | null }
    mockEditor.blocksToMarkdownLossy.mockReturnValueOnce(
      '# Test Project\n\n![shot](asset://localhost/%2Fvault%2Fattachments%2Fshot.png)\n',
    )

    const result = syncActiveTabIntoRawBuffer({
      editor: mockEditor as never,
      activeTabPath: mockEntry.path,
      activeTabContent: mockContent,
      rawLatestContentRef,
      vaultPath: '/vault',
    })

    expect(result).toBe(
      '---\ntitle: Test Project\nis_a: Project\nStatus: Active\n---\n# Test Project\n\n![shot](../attachments/shot.png)\n',
    )
    expect(rawLatestContentRef.current).toBe(result)
  })

  it('serializes rich math nodes back to Markdown source when entering raw mode', () => {
    const rawLatestContentRef = { current: null as string | null }
    const originalDocument = mockEditor.document
    const originalSerializer = mockEditor.blocksToMarkdownLossy.getMockImplementation()

    try {
      mockEditor.document = [
        {
          id: 'math-inline',
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Inline ', styles: {} },
            { type: 'mathInline', props: { latex: 'E=mc^2' } },
          ],
          props: {},
          children: [],
        },
        {
          id: 'math-block',
          type: 'mathBlock',
          props: { latex: '\\int_0^1 x\\,dx' },
          children: [],
        },
      ]
      mockEditor.blocksToMarkdownLossy.mockImplementation((blocks: unknown[]) => (
        (blocks as Array<{ content?: Array<{ text?: string }> }>)
          .map((block) => block.content?.map((item) => item.text ?? '').join('') ?? '')
          .join('\n\n')
      ))

      const result = syncActiveTabIntoRawBuffer({
        editor: mockEditor as never,
        activeTabPath: mockEntry.path,
        activeTabContent: mockContent,
        rawLatestContentRef,
      })

      expect(result).toBe(
        '---\ntitle: Test Project\nis_a: Project\nStatus: Active\n---\nInline $E=mc^2$\n\n$$\n\\int_0^1 x\\,dx\n$$\n',
      )
      expect(rawLatestContentRef.current).toBe(result)
    } finally {
      mockEditor.document = originalDocument
      mockEditor.blocksToMarkdownLossy.mockImplementation(originalSerializer)
    }
  })

  it('does not emit a content change when leaving raw mode without user edits', () => {
    const { onContentChange, result } = rememberRawExit(normalizedContent)

    expect(result).toBeNull()
    expect(onContentChange).not.toHaveBeenCalled()
  })

  it('emits a content change when leaving raw mode with edited markdown', () => {
    const editedContent = `${normalizedContent}\nUpdated in raw mode\n`
    const { onContentChange, result } = rememberRawExit(editedContent)

    expect(result).toEqual({ path: mockEntry.path, content: editedContent })
    expect(onContentChange).toHaveBeenCalledWith(mockEntry.path, editedContent)
  })

  it('keeps raw exit edits available until parent tab state catches up', () => {
    const editedContent = `${normalizedContent}\nEdited before switching tabs\n`
    const { result: pendingRawExitContent } = rememberRawExit(editedContent)
    expect(pendingRawExitContent).not.toBeNull()

    expect(applyPendingRawExitContent([mockTab, otherTab], pendingRawExitContent)[0]).toEqual({
      ...mockTab,
      content: editedContent,
    })
    expect(resolveRawModeContent({
      activeTab: mockTab,
      rawModeContentOverride: pendingRawExitContent,
    })).toBe(editedContent)

    expect(resolvePendingRawExitContent({
      activeTabPath: mockEntry.path,
      tabs: [mockTab, otherTab],
      pendingRawExitContent,
    })).toEqual(pendingRawExitContent)

    expect(resolvePendingRawExitContent({
      activeTabPath: mockEntry.path,
      tabs: [{ ...mockTab, content: editedContent }, otherTab],
      pendingRawExitContent,
    })).toBeNull()
  })
})
