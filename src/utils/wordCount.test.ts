import { describe, expect, it } from 'vitest'
import { countWords } from './wikilinks'

describe('multilingual word count', () => {
  it('counts the repeated English words from the reported example', () => {
    const content = ['abc, efg', 'abc, efg', 'abc, efg', 'abc, efg', 'abc', 'abc'].join('\n\n')

    expect(countWords(content)).toBe(10)
  })

  it('counts unspaced CJK characters instead of treating the line as one word', () => {
    expect(countWords('中文没有空格')).toBe(6)
  })

  it('counts CJK characters alongside Latin and numeric words', () => {
    expect(countWords('Hello 世界 2026')).toBe(4)
  })
})
