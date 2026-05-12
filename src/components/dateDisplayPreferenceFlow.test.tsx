import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppPreferencesProvider } from '../hooks/useAppPreferences'
import { NoteList } from './NoteList'
import { SmartPropertyValueCell } from './PropertyValueCells'
import {
  buildNoteListProps,
  makeEntry,
  makeTypeDefinition,
} from '../test-utils/noteListTestUtils'

function renderWithPreferences(ui: ReactElement) {
  return render(
    <TooltipProvider>
      <AppPreferencesProvider dateDisplayFormat="european">
        {ui}
      </AppPreferencesProvider>
    </TooltipProvider>,
  )
}

describe('date display preference flow', () => {
  it('formats note-list date chips from the shared preference provider', () => {
    const entries = [
      makeTypeDefinition('Book', ['Due']),
      makeEntry({
        path: '/vault/book.md',
        filename: 'book.md',
        title: 'Book Note',
        isA: 'Book',
        properties: { Due: '2026-05-11' },
      }),
    ]
    const { props } = buildNoteListProps({
      entries,
      selection: { kind: 'sectionGroup', type: 'Book' },
    })

    renderWithPreferences(<NoteList {...props} />)

    expect(screen.getByTestId('property-chip-due-0')).toHaveTextContent('11/5/2026')
  })

  it('keeps date editor input ISO while display text follows the shared preference', () => {
    renderWithPreferences(
      <SmartPropertyValueCell
        propKey="Due"
        value="2026-04-20"
        displayMode="date"
        isEditing={true}
        vaultStatuses={[]}
        vaultTags={[]}
        onStartEdit={vi.fn()}
        onSave={vi.fn()}
        onSaveList={vi.fn()}
      />,
    )

    expect(screen.getByTestId('date-display')).toHaveTextContent('20/4/2026')
    expect(screen.getByTestId('date-picker-input')).toHaveValue('2026-04-20')
  })
})
