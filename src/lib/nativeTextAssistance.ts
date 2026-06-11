export const nativeTextAssistanceDisabledAttributes = {
  spellcheck: 'false',
  autocomplete: 'off',
} as const

export const nativeTextAssistanceDisabledProps = {
  spellCheck: false,
  autoComplete: 'off',
} as const

export const rawEditorTextInputAttributes = {
  ...nativeTextAssistanceDisabledAttributes,
  autocorrect: 'on',
  autocapitalize: 'sentences',
} as const

const TEXT_ENTRY_SELECTOR = [
  'textarea',
  '[contenteditable="true"]',
  'input:not([type])',
  'input[type="email"]',
  'input[type="number"]',
  'input[type="password"]',
  'input[type="search"]',
  'input[type="tel"]',
  'input[type="text"]',
  'input[type="url"]',
].join(',')

function isElement(node: ParentNode): node is Element {
  return typeof Element !== 'undefined' && node instanceof Element
}

function setNativeTextAssistanceDisabled(element: Element) {
  for (const [attribute, value] of Object.entries(nativeTextAssistanceDisabledAttributes)) {
    if (element.getAttribute(attribute) !== value) {
      element.setAttribute(attribute, value)
    }
  }
}

export function disableNativeTextAssistance(root: ParentNode) {
  if (isElement(root) && root.matches(TEXT_ENTRY_SELECTOR)) {
    setNativeTextAssistanceDisabled(root)
  }

  root.querySelectorAll(TEXT_ENTRY_SELECTOR).forEach(setNativeTextAssistanceDisabled)
}

export function observeNativeTextAssistanceDisabled(root: ParentNode): () => void {
  disableNativeTextAssistance(root)

  if (typeof MutationObserver === 'undefined') {
    return () => {}
  }

  const observer = new MutationObserver(() => disableNativeTextAssistance(root))
  observer.observe(root, {
    attributeFilter: ['contenteditable'],
    attributes: true,
    childList: true,
    subtree: true,
  })

  return () => observer.disconnect()
}
