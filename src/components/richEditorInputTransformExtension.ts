import { createArrowLigatureInputTransform } from './arrowLigaturesExtension'
import { createMarkdownHighlightInputTransform } from './markdownHighlightInputExtension'
import { createMathInputTransform } from './mathInputExtension'
import { createRichEditorInputTransformExtension } from './richEditorInputTransform'
import { createTrackedWikilinkInputTransform } from './wikilinkInputExtension'

export const createRichEditorMarkdownInputTransformExtension = createRichEditorInputTransformExtension({
  createTransforms: () => [
    createArrowLigatureInputTransform(),
    createMarkdownHighlightInputTransform(),
    createMathInputTransform(),
    createTrackedWikilinkInputTransform(),
  ],
  key: 'richEditorMarkdownInputTransform',
})
