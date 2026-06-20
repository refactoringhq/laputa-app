import type { SheetFormulaSuggestion } from '../utils/sheetFormulaAutocomplete'

export interface SheetFormulaAutocompleteMenuState {
  suggestions: SheetFormulaSuggestion[]
  selectedIndex: number
  left: number
  top: number
  width: number
}

interface SheetFormulaAutocompleteMenuProps {
  state: SheetFormulaAutocompleteMenuState
  onApplySuggestion: (suggestion: SheetFormulaSuggestion) => void
  onSelectIndex: (index: number) => void
}

export function SheetFormulaAutocompleteMenu({
  state,
  onApplySuggestion,
  onSelectIndex,
}: SheetFormulaAutocompleteMenuProps) {
  return (
    <div
      className="sheet-formula-autocomplete"
      role="listbox"
      style={{
        left: state.left,
        top: state.top,
        minWidth: state.width,
      }}
    >
      {state.suggestions.map((suggestion, index) => (
        <div
          aria-selected={index === state.selectedIndex}
          className="sheet-formula-autocomplete__item"
          key={suggestion.name}
          onMouseDown={(event) => {
            event.preventDefault()
            onApplySuggestion(suggestion)
          }}
          onMouseEnter={() => {
            onSelectIndex(index)
          }}
          role="option"
          tabIndex={-1}
        >
          <span className="sheet-formula-autocomplete__name">{suggestion.name}</span>
          <span className="sheet-formula-autocomplete__signature">{suggestion.signature}</span>
          <span className="sheet-formula-autocomplete__category">{suggestion.category}</span>
          <span className="sheet-formula-autocomplete__description">{suggestion.description}</span>
        </div>
      ))}
    </div>
  )
}
