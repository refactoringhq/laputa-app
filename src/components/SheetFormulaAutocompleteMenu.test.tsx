import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SheetFormulaAutocompleteMenu } from './SheetFormulaAutocompleteMenu'
import { matchFormulaAutocomplete } from '../utils/sheetFormulaAutocomplete'
import { translate } from '../lib/i18n'

describe('SheetFormulaAutocompleteMenu', () => {
  it('renders localized formula metadata and applies the selected suggestion', () => {
    const match = matchFormulaAutocomplete('=SU', 3, 'it-IT')
    const sum = match?.suggestions.find((suggestion) => suggestion.name === 'SUM')
    expect(sum).toBeDefined()

    const onApplySuggestion = vi.fn()
    const onSelectIndex = vi.fn()
    render(
      <SheetFormulaAutocompleteMenu
        state={{
          suggestions: [sum!],
          selectedIndex: 0,
          left: 12,
          top: 24,
          width: 180,
        }}
        onApplySuggestion={onApplySuggestion}
        onSelectIndex={onSelectIndex}
      />,
    )

    const option = screen.getByRole('option')
    expect(option).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('SUM')).toBeInTheDocument()
    expect(screen.getByText(translate('it-IT', 'editor.sheet.formula.category.math'))).toBeInTheDocument()
    expect(screen.getByText(translate('it-IT', 'editor.sheet.formula.description.sum'))).toBeInTheDocument()

    fireEvent.mouseEnter(option)
    fireEvent.mouseDown(option)

    expect(onSelectIndex).toHaveBeenCalledWith(0)
    expect(onApplySuggestion).toHaveBeenCalledWith(sum)
  })
})
