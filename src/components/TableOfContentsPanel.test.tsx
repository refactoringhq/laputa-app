import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../types'
import { TableOfContentsPanel } from './TableOfContentsPanel'
import { buildTableOfContents, buildTableOfContentsFromMarkdown } from './tableOfContentsModel'

const entry = {
  title: 'The Compounding Software Factory',
} as VaultEntry

const blocks = [
  { id: 'h1', type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: 'The default path is degradation' }] },
  { id: 'h2', type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'What causes teams to degrade' }] },
  { id: 'h3', type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: 'Poor coding hygiene' }] },
  { id: 'ignored', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Body' }] },
]

describe('TableOfContentsPanel', () => {
  it('builds a title-rooted H1/H2/H3 hierarchy', () => {
    const toc = buildTableOfContents(entry.title, blocks)

    expect(toc.title).toBe('The Compounding Software Factory')
    expect(toc.children[0].title).toBe('The default path is degradation')
    expect(toc.children[0].children[0].title).toBe('What causes teams to degrade')
    expect(toc.children[0].children[0].children[0].title).toBe('Poor coding hygiene')
  })

  it('does not duplicate the note title when the first markdown H1 matches it', () => {
    const toc = buildTableOfContentsFromMarkdown(
      'Introducing Tolaria',
      '# Introducing Tolaria\n\n## Tolaria + Refactoring\n\n## Principles',
    )

    expect(toc.title).toBe('Introducing Tolaria')
    expect(toc.children.map((item) => item.title)).toEqual(['Tolaria + Refactoring', 'Principles'])
  })

  it('keeps navigation ids after removing a duplicate markdown title H1', async () => {
    const setTextCursorPosition = vi.fn()
    render(
      <TableOfContentsPanel
        editor={{
          document: [
            { id: 'title-block', type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: 'Introducing Tolaria' }] },
            { id: 'section-block', type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Tolaria + Refactoring' }] },
          ],
          setTextCursorPosition,
        }}
        entry={{ ...entry, title: 'Introducing Tolaria' } as VaultEntry}
        sourceContent={'# Introducing Tolaria\n\n## Tolaria + Refactoring'}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /Introducing Tolaria/ }))
    expect(setTextCursorPosition).toHaveBeenCalledWith('title-block', 'start')

    fireEvent.click(await screen.findByRole('button', { name: /Tolaria \+ Refactoring/ }))
    expect(setTextCursorPosition).toHaveBeenCalledWith('section-block', 'start')
  })

  it('resolves navigation ids on click after the async TOC build starts without ids', async () => {
    const setTextCursorPosition = vi.fn()
    const editor = {
      document: [] as unknown[],
      setTextCursorPosition,
    }
    render(
      <TableOfContentsPanel
        editor={editor}
        entry={{ ...entry, title: 'New Note' } as VaultEntry}
        sourceContent={'# New Note\n\n## New Heading'}
        onClose={vi.fn()}
      />,
    )

    await screen.findByRole('button', { name: /New Heading/ })
    editor.document = [
      { id: 'title-block', type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: 'New Note' }] },
      { id: 'new-heading-block', type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'New Heading' }] },
    ]

    fireEvent.click(screen.getByRole('button', { name: /New Heading/ }))
    expect(setTextCursorPosition).toHaveBeenCalledWith('new-heading-block', 'start')
  })

  it('updates from source content even when the editor document is stale', async () => {
    const { rerender } = render(
      <TableOfContentsPanel
        editor={{ document: blocks, setTextCursorPosition: vi.fn() }}
        entry={{ ...entry, title: 'Old Note' } as VaultEntry}
        sourceContent={'# Old Note\n\n## Old Heading'}
        onClose={vi.fn()}
      />,
    )

    await screen.findByRole('button', { name: /Old Heading/ })
    rerender(
      <TableOfContentsPanel
        editor={{ document: blocks, setTextCursorPosition: vi.fn() }}
        entry={{ ...entry, title: 'New Note' } as VaultEntry}
        sourceContent={'# New Note\n\n## New Heading'}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /New Note/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Old Heading/ })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /New Heading/ })).toBeInTheDocument()
  })

  it('does not show stale editor headings while new note source content is loading', () => {
    render(
      <TableOfContentsPanel
        editor={{ document: blocks, setTextCursorPosition: vi.fn() }}
        entry={{ ...entry, title: 'New Note' } as VaultEntry}
        sourceContent={null}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /New Note/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /The default path is degradation/ })).not.toBeInTheDocument()
  })

  it('renders heading icons, nesting guides, and navigates to clicked headings', async () => {
    const setTextCursorPosition = vi.fn()
    render(
      <TableOfContentsPanel
        editor={{ document: blocks, setTextCursorPosition }}
        entry={entry}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Table of Contents')).toBeInTheDocument()
    expect(await screen.findByTestId('toc-connector:toc-title')).toBeInTheDocument()
    expect(screen.getByTestId('toc-connector:h1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /What causes teams to degrade/ }))
    expect(setTextCursorPosition).toHaveBeenCalledWith('h2', 'start')
  })
})
