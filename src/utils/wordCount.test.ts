import { describe, expect, it } from 'vitest'
import { countWords } from './wikilinks'
import wordCountContract from '../shared/wordCountContract.json'

describe('multilingual word count', () => {
  it.each(wordCountContract.fixtures)('$name', ({ content, expected }) => {
    expect(countWords(content)).toBe(expected)
  })
})
