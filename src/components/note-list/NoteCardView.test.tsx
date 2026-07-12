import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NoteCardView } from './NoteCardView'
import { makeEntry } from '../../test-utils/noteListTestUtils'

const { convertFileSrcMock, tauriState } = vi.hoisted(() => ({
  convertFileSrcMock: vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`),
  tauriState: { enabled: false },
}))

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: convertFileSrcMock,
}))

vi.mock('../../mock-tauri', () => ({
  isTauri: () => tauriState.enabled,
}))

function assetUrl(path: string): string {
  return `asset://localhost/${encodeURIComponent(path)}`
}

describe('NoteCardView', () => {
  beforeEach(() => {
    tauriState.enabled = false
    convertFileSrcMock.mockClear()
  })

  it('renders empty message when no entries', () => {
    render(<NoteCardView entries={[]} selectedNotePath={null} onSelectNote={() => {}} />)
    expect(screen.getByText(/no notes/i)).toBeInTheDocument()
  })

  it('renders a card for each entry', () => {
    const entries = [
      makeEntry({ title: 'Pancakes', path: '/vault/pancakes.md' }),
      makeEntry({ title: 'Waffles', path: '/vault/waffles.md' }),
    ]
    const { container } = render(<NoteCardView entries={entries} selectedNotePath={null} onSelectNote={() => {}} />)
    expect(screen.getByText('Pancakes')).toBeInTheDocument()
    expect(screen.getByText('Waffles')).toBeInTheDocument()
    expect(container.querySelectorAll('button')).toHaveLength(2)
  })

  it('calls onSelectNote when card is clicked', () => {
    const entry = makeEntry({ title: 'Test Recipe', path: '/vault/test.md' })
    const onSelect = vi.fn()
    const { container } = render(<NoteCardView entries={[entry]} selectedNotePath={null} onSelectNote={onSelect} />)
    const button = container.querySelector('button')
    fireEvent.click(button!)
    expect(onSelect).toHaveBeenCalledWith(entry)
  })

  it('highlights selected note with blue border', () => {
    const entry = makeEntry({ title: 'Selected', path: '/vault/selected.md' })
    const { container } = render(<NoteCardView entries={[entry]} selectedNotePath="/vault/selected.md" onSelectNote={() => {}} />)
    const button = container.querySelector('button')!
    expect(button.style.borderLeft).toContain('var(--accent-blue)')
  })

  it('renders placeholder color for entries without images', () => {
    const entry = makeEntry({ title: 'No Image Note', path: '/vault/noimg.md' })
    const { container } = render(<NoteCardView entries={[entry]} selectedNotePath={null} onSelectNote={() => {}} />)
    const button = container.querySelector('button')!
    // Should have a background color set (not the default muted)
    expect(button.style.backgroundColor).toBeTruthy()
    expect(button.style.backgroundColor).not.toBe('var(--muted)')
  })

  it('resolves note-relative first images against the note directory', () => {
    tauriState.enabled = true
    const entry = makeEntry({
      title: 'Pasta',
      path: '/vault/Recipes/Pasta.md',
      firstImage: 'photo.jpg',
    })
    const { container } = render(
      <NoteCardView entries={[entry]} vaultPath="/vault" selectedNotePath={null} onSelectNote={() => {}} />,
    )

    expect(container.querySelector('img')?.getAttribute('src')).toBe(assetUrl('/vault/Recipes/photo.jpg'))
  })

  it('does not render note-relative first images that escape the vault', () => {
    tauriState.enabled = true
    const entry = makeEntry({
      title: 'Outside',
      path: '/vault/Recipes/Pasta.md',
      firstImage: '../../outside.jpg',
    })
    const { container } = render(
      <NoteCardView entries={[entry]} vaultPath="/vault" selectedNotePath={null} onSelectNote={() => {}} />,
    )

    expect(container.querySelector('img')).toBeNull()
  })
})
