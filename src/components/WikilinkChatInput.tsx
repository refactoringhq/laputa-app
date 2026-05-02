import type { CSSProperties } from 'react'
import type { VaultEntry } from '../types'
import type { NoteReference } from '../utils/ai-context'
import { InlineWikilinkInput } from './InlineWikilinkInput'

interface WikilinkChatInputProps {
  entries: VaultEntry[]
  value: string
  onChange: (value: string) => void
  onSend: (text: string, references: NoteReference[]) => void
  onUnsupportedPaste?: (message: string) => void
  disabled?: boolean
  placeholder?: string
  inputRef?: React.RefObject<HTMLDivElement | null>
  editorClassName?: string
  editorStyle?: CSSProperties
}

export function WikilinkChatInput({
  entries,
  value,
  onChange,
  onSend,
  onUnsupportedPaste,
  disabled,
  placeholder,
  inputRef,
  editorClassName,
  editorStyle,
}: WikilinkChatInputProps) {
  return (
    <InlineWikilinkInput
      entries={entries}
      value={value}
      onChange={onChange}
      onSubmit={onSend}
      onUnsupportedPaste={onUnsupportedPaste}
      disabled={disabled}
      placeholder={placeholder}
      inputRef={inputRef}
      editorClassName={editorClassName}
      editorStyle={editorStyle}
    />
  )
}
