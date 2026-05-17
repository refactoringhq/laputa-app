import { describe, expect, it } from 'vitest'
import { makeEntry } from '../test-utils/noteListTestUtils'
import { buildInlineWikilinkSuggestions } from './inlineWikilinkSuggestions'

describe('buildInlineWikilinkSuggestions', () => {
  it('deduplicates and disambiguates empty-query suggestions', () => {
    const suggestions = buildInlineWikilinkSuggestions([
      makeEntry({ path: '/vault/projects/alpha.md', title: 'Alpha' }),
      makeEntry({ path: '/vault/archive/alpha.md', title: 'Alpha' }),
      makeEntry({ path: '/vault/projects/alpha.md', title: 'Alpha Duplicate' }),
    ], '')

    expect(suggestions.map((suggestion) => suggestion.title)).toEqual([
      'Alpha (archive)',
      'Alpha (projects)',
    ])
  })
})
