import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { useCreateBlockNote } from '@blocknote/react'
import { createTolariaCodeBlockOptions } from './codeBlockOptions'
import { BLOCK_CONTAINER_SELECTOR } from './tolariaBlockNoteDom'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'

type CodeBlockLanguageEditor = ReturnType<typeof useCreateBlockNote>

type CodeBlockLanguageTarget = {
  blockId: string
  editable: boolean
  height: number
  language: string
  left: number
  top: number
}

type LanguageSelectControl = Element & { value: string }

const NATIVE_LANGUAGE_CONTROL_SELECTOR =
  '.bn-block-content[data-content-type="codeBlock"] > div > select'
const ELEMENT_NODE = 1

const LANGUAGE_OPTIONS = Object.entries(
  createTolariaCodeBlockOptions().supportedLanguages ?? {},
).map(([id, language]) => ({ id, name: language.name }))

function liveCodeBlock(editor: CodeBlockLanguageEditor, blockId: string): boolean {
  try {
    return editor.getBlock(blockId)?.type === 'codeBlock'
  } catch {
    return false
  }
}

function languageControlTarget(
  editor: CodeBlockLanguageEditor,
  blockId: string,
  nativeControl: LanguageSelectControl,
): CodeBlockLanguageTarget {
  const rect = nativeControl.getBoundingClientRect()
  return {
    blockId,
    editable: editor.isEditable
      && nativeControl.closest('.bn-editor')?.getAttribute('contenteditable') !== 'false',
    height: rect.height,
    language: nativeControl.value || 'text',
    left: rect.left,
    top: rect.top,
  }
}

function codeBlockLanguageTarget(
  editor: CodeBlockLanguageEditor,
  element: Element,
): CodeBlockLanguageTarget | null {
  if (element.tagName !== 'SELECT') return null
  const nativeControl = element as LanguageSelectControl
  const blockId = element.closest(BLOCK_CONTAINER_SELECTOR)?.getAttribute('data-id')
  if (!blockId) return null
  if (!liveCodeBlock(editor, blockId)) return null
  return languageControlTarget(editor, blockId, nativeControl)
}

function codeBlockLanguageTargets(editor: CodeBlockLanguageEditor): CodeBlockLanguageTarget[] {
  return Array.from(document.querySelectorAll(NATIVE_LANGUAGE_CONTROL_SELECTOR))
    .map((element) => codeBlockLanguageTarget(editor, element))
    .filter((target): target is CodeBlockLanguageTarget => target !== null)
}

function sameTargets(current: CodeBlockLanguageTarget[], next: CodeBlockLanguageTarget[]): boolean {
  return JSON.stringify(current) === JSON.stringify(next)
}

function addedNodeTouchesEditor(node: Node): boolean {
  if (node.nodeType !== ELEMENT_NODE) return false
  const element = node as Element
  return element.matches('.bn-editor') || element.querySelector('.bn-editor') !== null
}

function mutationTouchesEditor(mutation: MutationRecord): boolean {
  if (mutation.target.nodeType === ELEMENT_NODE
    && (mutation.target as Element).closest('.bn-editor')) return true
  return Array.from(mutation.addedNodes).some(addedNodeTouchesEditor)
}

function useCodeBlockLanguageTargets(editor: CodeBlockLanguageEditor) {
  const [targets, setTargets] = useState<CodeBlockLanguageTarget[]>([])

  useEffect(() => {
    let refreshFrame: number | null = null
    const refresh = () => {
      if (refreshFrame !== null) return
      refreshFrame = requestAnimationFrame(() => {
        refreshFrame = null
        const nextTargets = codeBlockLanguageTargets(editor)
        setTargets((current) => sameTargets(current, nextTargets) ? current : nextTargets)
      })
    }
    const observer = new MutationObserver((mutations) => {
      if (mutations.some(mutationTouchesEditor)) refresh()
    })
    observer.observe(document.body, {
      attributeFilter: ['contenteditable'],
      attributes: true,
      childList: true,
      subtree: true,
    })
    const unsubscribe = editor.onChange?.(refresh) ?? (() => {})
    window.addEventListener('resize', refresh)
    document.addEventListener('scroll', refresh, true)
    refresh()

    return () => {
      if (refreshFrame !== null) cancelAnimationFrame(refreshFrame)
      observer.disconnect()
      unsubscribe()
      window.removeEventListener('resize', refresh)
      document.removeEventListener('scroll', refresh, true)
    }
  }, [editor])

  return targets
}

function updateCodeBlockLanguage(
  editor: CodeBlockLanguageEditor,
  blockId: string,
  language: string,
): void {
  if (!editor.isEditable) return

  try {
    const block = editor.getBlock(blockId)
    if (block?.type !== 'codeBlock') return
    editor.updateBlock(blockId, { props: { language } })
  } catch {
    // BlockNote can remove a block between the picker opening and selection.
  }
}

function CodeBlockLanguagePicker({
  blockId,
  editable,
  editor,
  language,
}: {
  blockId: string
  editable: boolean
  editor: CodeBlockLanguageEditor
  language: string
}) {
  return (
    <Select
      disabled={!editable}
      value={language}
      onValueChange={(nextLanguage) => updateCodeBlockLanguage(editor, blockId, nextLanguage)}
    >
      <SelectTrigger
        size="sm"
        className="editor__code-block-language-trigger h-7 max-w-72 border-transparent bg-transparent px-2 py-0 text-xs text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-1"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {LANGUAGE_OPTIONS.map(({ id, name }) => (
          <SelectItem key={id} value={id}>{name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function CodeBlockLanguageControls({ editor }: { editor: CodeBlockLanguageEditor }) {
  const targets = useCodeBlockLanguageTargets(editor)

  return targets.map((target) => createPortal(
    <div
      className="editor__code-block-language-overlay"
      data-code-block-id={target.blockId}
      style={{ left: target.left, minHeight: target.height, top: target.top }}
    >
      <CodeBlockLanguagePicker
        blockId={target.blockId}
        editable={target.editable}
        editor={editor}
        language={target.language}
      />
    </div>,
    document.body,
    target.blockId,
  ))
}
