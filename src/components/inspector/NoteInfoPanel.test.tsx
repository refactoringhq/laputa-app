import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NoteInfoPanel } from './NoteInfoPanel'
import type { VaultEntry } from '../../types'

function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    path: '/vault/test.md', filename: 'test.md', title: 'Test', isA: 'Note',
    aliases: [], outgoingLinks: [], relationships: {}, tags: [],
    modifiedAt: 1700000000, createdAt: 1700000000, fileSize: 1024,
    icon: null, color: null, archived: false, favorite: false,
    ...overrides,
  }
}

describe('NoteInfoPanel', () => {
  it('renders Info section header with icon', () => {
    render(<NoteInfoPanel entry={makeEntry()} content="" />)
    expect(screen.getByText('Info')).toBeInTheDocument()
  })

  it('renders Modified and Words in read-only Info section', () => {
    render(<NoteInfoPanel entry={makeEntry({ modifiedAt: 1700000000 })} content="---\ntitle: Test\n---\nOne two three" />)
    const readOnlyRows = screen.getAllByTestId('readonly-property')
    const labels = readOnlyRows.map(row => row.querySelector('span')?.textContent)
    expect(labels).toContain('Modified')
    expect(labels).toContain('Words')
  })

  it('renders Created date', () => {
    render(<NoteInfoPanel entry={makeEntry({ createdAt: 1700000000 })} content="" />)
    const readOnlyRows = screen.getAllByTestId('readonly-property')
    const labels = readOnlyRows.map(row => row.querySelector('span')?.textContent)
    expect(labels).toContain('Created')
  })

  it('renders file size', () => {
    render(<NoteInfoPanel entry={makeEntry({ fileSize: 4300 })} content="" />)
    expect(screen.getByText('Size')).toBeInTheDocument()
    expect(screen.getByText('4.2 KB')).toBeInTheDocument()
  })

  it('shows em dash for null timestamps', () => {
    render(<NoteInfoPanel entry={makeEntry({ modifiedAt: null, createdAt: null })} content="" />)
    const dashes = screen.getAllByText('\u2014')
    expect(dashes.length).toBeGreaterThanOrEqual(2)
  })

  it('read-only rows do not have hover styling', () => {
    render(<NoteInfoPanel entry={makeEntry()} content="" />)
    const readOnlyRows = screen.getAllByTestId('readonly-property')
    readOnlyRows.forEach(row => {
      expect(row.className).not.toContain('hover:bg-muted')
    })
  })

  it('formats file sizes correctly', () => {
    const { rerender } = render(<NoteInfoPanel entry={makeEntry({ fileSize: 500 })} content="" />)
    expect(screen.getByText('500 B')).toBeInTheDocument()

    rerender(<NoteInfoPanel entry={makeEntry({ fileSize: 2048 })} content="" />)
    expect(screen.getByText('2.0 KB')).toBeInTheDocument()

    rerender(<NoteInfoPanel entry={makeEntry({ fileSize: 1048576 })} content="" />)
    expect(screen.getByText('1.0 MB')).toBeInTheDocument()
  })

  it('uses CSS grid with two equal columns on read-only rows', () => {
    render(<NoteInfoPanel entry={makeEntry()} content="" />)
    const readOnlyRows = screen.getAllByTestId('readonly-property')
    readOnlyRows.forEach(row => {
      expect(row.className).toContain('grid')
      expect(row.className).toContain('grid-cols-2')
    })
  })

  it('renders the derived word count stored on the entry', () => {
    render(<NoteInfoPanel entry={makeEntry({ wordCount: 42 })} content="One word" />)
    expect(screen.getByText('42')).toBeInTheDocument()
  })
})
