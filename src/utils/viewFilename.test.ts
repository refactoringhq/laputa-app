import { describe, expect, it } from 'vitest'
import { createViewFilename, slugifyViewFilenameStem } from './viewFilename'

describe('slugifyViewFilenameStem', () => {
  it('turns awkward custom view names into portable filename stems', () => {
    expect(slugifyViewFilenameStem(' Project / Q2: Launch 🚀 ')).toBe('project-q2-launch')
    expect(slugifyViewFilenameStem('...Roadmap...')).toBe('roadmap')
    expect(slugifyViewFilenameStem('你好')).toBe('你好')
  })

  it('falls back for symbol-only names and avoids Windows reserved device names', () => {
    expect(slugifyViewFilenameStem('🚀')).toBe('view')
    expect(slugifyViewFilenameStem('CON')).toBe('con-view')
  })
})

describe('createViewFilename', () => {
  it('adds the yml extension and avoids duplicate sanitized filenames', () => {
    expect(createViewFilename('Project / Q2', ['project-q2.yml', 'project-q2-2.yml']))
      .toBe('project-q2-3.yml')
  })

  it('compares existing filenames case-insensitively', () => {
    expect(createViewFilename('Roadmap', ['Roadmap.yml'])).toBe('roadmap-2.yml')
  })
})
