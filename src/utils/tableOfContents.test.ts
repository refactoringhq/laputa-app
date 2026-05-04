import { describe, expect, it } from 'vitest'
import { extractTableOfContents } from './tableOfContents'

describe('extractTableOfContents', () => {
  it('builds a nested outline from BlockNote heading blocks', () => {
    const blocks = [
      {
        id: 'intro',
        type: 'heading',
        props: { level: 1 },
        content: [
          { type: 'text', text: 'Intro' },
          { type: 'text', text: ' overview' },
        ],
      },
      {
        id: 'body',
        type: 'paragraph',
        content: [{ type: 'text', text: 'Ignored paragraph' }],
      },
      {
        id: 'scope',
        type: 'heading',
        props: { level: 2 },
        content: [{ type: 'text', text: 'Scope' }],
      },
      {
        id: 'detail',
        type: 'heading',
        props: { level: 3 },
        content: [{ type: 'link', content: [{ type: 'text', text: 'Deep link' }] }],
      },
      {
        id: 'next',
        type: 'heading',
        props: { level: 2 },
        content: 'Next steps',
      },
    ]

    expect(extractTableOfContents(blocks)).toEqual([
      {
        id: 'intro',
        level: 1,
        text: 'Intro overview',
        children: [
          {
            id: 'scope',
            level: 2,
            text: 'Scope',
            children: [
              {
                id: 'detail',
                level: 3,
                text: 'Deep link',
                children: [],
              },
            ],
          },
          {
            id: 'next',
            level: 2,
            text: 'Next steps',
            children: [],
          },
        ],
      },
    ])
  })

  it('keeps nested BlockNote children in document order', () => {
    const blocks = [
      {
        id: 'parent',
        type: 'paragraph',
        children: [
          {
            id: 'child-heading',
            type: 'heading',
            props: { level: '2' },
            content: [{ type: 'text', text: 'Child heading' }],
          },
        ],
      },
      {
        id: 'top-heading',
        type: 'heading',
        props: { level: 1 },
        content: [{ type: 'text', text: 'Top heading' }],
      },
    ]

    expect(extractTableOfContents(blocks).map((item) => item.id)).toEqual([
      'child-heading',
      'top-heading',
    ])
  })

  it('ignores malformed headings without stable ids or levels', () => {
    expect(extractTableOfContents([
      { id: '', type: 'heading', props: { level: 1 }, content: 'No id' },
      { id: 'bad-level', type: 'heading', props: { level: 9 }, content: 'Bad level' },
      { id: 'ok', type: 'heading', props: { level: 2 }, content: [] },
    ])).toEqual([
      {
        id: 'ok',
        level: 2,
        text: '',
        children: [],
      },
    ])
  })
})
