import { describe, expect, it } from 'vitest'
import { preProcessEditorMarkdown } from './editorBlockResolution'

describe('preProcessEditorMarkdown', () => {
  it('prepares currency prose without single-tilde strike or inline math placeholders', () => {
    const markdown = [
      '# Finance',
      '',
      '### 6. Stop new Pro/Business customers from quitting in months 1-2 (~$1.5k/mo now, ~$3k/mo by autumn)',
      '',
      'Monthly subscribers are worth ~$115 lifetime vs ~$223 for old Creator.',
      '',
      'Keep ~~deleted~~ marked.',
    ].join('\n')

    const preprocessed = preProcessEditorMarkdown(markdown)

    expect(preprocessed).toContain('\\~$1.5k/mo now, \\~$3k/mo')
    expect(preprocessed).toContain('\\~$115 lifetime vs \\~$223')
    expect(preprocessed).toContain('~~deleted~~')
    expect(preprocessed).not.toContain('TOLARIA_MATH_INLINE')
  })
})
