import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ListView } from './NoteListViews'
import { makeEntry } from '../../test-utils/noteListTestUtils'
import type { VaultEntry } from '../../types'

const renderItem = (entry: VaultEntry) => <div data-testid="note-row">{entry.title}</div>

const entries = [
  makeEntry({ path: '/a.md', filename: 'a.md', title: 'Alpha' }),
  makeEntry({ path: '/b.md', filename: 'b.md', title: 'Beta' }),
]

describe('ListView bottom overlay clearance', () => {
  it('renders a bottom spacer so the last note can scroll above the filter pills overlay', () => {
    render(<ListView searched={entries} query="" renderItem={renderItem} hasBottomOverlay />)

    expect(screen.getByTestId('note-list-bottom-overlay-spacer')).toBeInTheDocument()
  })

  it('renders no spacer when there is no bottom overlay', () => {
    render(<ListView searched={entries} query="" renderItem={renderItem} />)

    expect(screen.queryByTestId('note-list-bottom-overlay-spacer')).not.toBeInTheDocument()
  })

  it('keeps the clearance in the empty state so the message stays above the overlay', () => {
    render(<ListView searched={[]} query="" renderItem={renderItem} hasBottomOverlay />)

    expect(screen.getByTestId('note-list-bottom-overlay-spacer')).toBeInTheDocument()
  })
})
