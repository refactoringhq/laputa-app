import { describe, expect, it } from 'vitest'
import { blockNoteDictionaryForLocale } from './blockNoteDictionary'

describe('blockNoteDictionaryForLocale', () => {
  it('adds the multi-column dictionary required by the BlockNote extension', () => {
    expect(blockNoteDictionaryForLocale('en')).toMatchObject({
      slash_menu: expect.any(Object),
      multi_column: {
        slash_menu: {
          two_columns: expect.objectContaining({
            title: 'Two Columns',
            aliases: expect.arrayContaining(['columns']),
          }),
          three_columns: expect.objectContaining({
            title: 'Three Columns',
            aliases: expect.arrayContaining(['columns']),
          }),
        },
      },
    })
  })

  it('falls back to English for app locales not shipped by BlockNote multi-column', () => {
    expect(blockNoteDictionaryForLocale('sv-SE').multi_column.slash_menu.two_columns.title)
      .toBe('Two Columns')
  })
})
