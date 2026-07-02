import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useTurnCurrentBlockIntoCommand } from './useTurnCurrentBlockIntoCommand'
import type { RichEditorBlockTypeDefinition } from '../utils/richEditorBlockTypes'

vi.mock('../lib/telemetry', () => ({
  trackEvent: vi.fn(),
}))

const headingTwo = {
  key: 'heading-2',
  labelKey: 'editor.blockType.heading2',
  name: 'Heading 2',
  props: { level: 2 },
  type: 'heading',
} satisfies RichEditorBlockTypeDefinition

type HookConfig = Parameters<typeof useTurnCurrentBlockIntoCommand>[0]

function createEditor(): HookConfig['editor'] {
  const block = { id: 'focused-block', type: 'paragraph', props: {}, content: [], children: [] }
  return {
    focus: vi.fn(),
    getBlock: vi.fn((id: string) => (id === block.id ? block : undefined)),
    getTextCursorPosition: vi.fn(() => ({ block })),
    transact: vi.fn((callback: () => void) => callback()),
    updateBlock: vi.fn(),
  } as unknown as HookConfig['editor']
}

describe('useTurnCurrentBlockIntoCommand', () => {
  it('registers a command-palette bridge for changing the focused block type', () => {
    const editor = createEditor()
    const turnCurrentBlockIntoRef: HookConfig['turnCurrentBlockIntoRef'] = { current: null }

    renderHook(() => useTurnCurrentBlockIntoCommand({
      activeTab: { content: '# Note', entry: { fileKind: 'markdown', path: 'Note.md' } } as HookConfig['activeTab'],
      diffMode: false,
      editor,
      rawMode: false,
      turnCurrentBlockIntoRef,
    }))

    expect(typeof turnCurrentBlockIntoRef.current).toBe('function')

    act(() => turnCurrentBlockIntoRef.current?.(headingTwo))

    expect(editor.updateBlock).toHaveBeenCalledWith('focused-block', {
      type: 'heading',
      props: { level: 2 },
    })
  })
})
