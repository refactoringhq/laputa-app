import { Folder } from '@phosphor-icons/react'
import { Input } from '@/components/ui/input'
import { useSidebarInlineRenameInput } from '../sidebar/sidebarHooks'

interface FolderNameInputProps {
  ariaLabel: string
  initialValue: string
  placeholder: string
  leftInset?: number
  selectTextOnFocus?: boolean
  submitOnBlur?: boolean
  testId: string
  onCancel: () => void
  onSubmit: (value: string) => Promise<boolean> | boolean
}

export function FolderNameInput({
  ariaLabel,
  initialValue,
  placeholder,
  leftInset = 16,
  selectTextOnFocus = false,
  submitOnBlur = false,
  testId,
  onCancel,
  onSubmit,
}: FolderNameInputProps) {
  const {
    handleKeyDown,
    inputRef,
    setValue,
    submitValue,
    value,
  } = useSidebarInlineRenameInput({
    initialValue,
    onCancel,
    onSubmit,
    selectTextOnFocus,
  })

  return (
    <div className="flex items-center gap-2 rounded" style={{ paddingTop: 6, paddingBottom: 6, paddingRight: 16, paddingLeft: leftInset, borderRadius: 4 }}>
      <Folder size={17} className="size-[17px] shrink-0 text-muted-foreground" />
      <Input
        ref={inputRef}
        aria-label={ariaLabel}
        className="h-auto min-h-0 flex-1 rounded-sm px-2 py-[3px] text-[13px] font-medium"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={submitOnBlur ? () => { void submitValue() } : undefined}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        data-testid={testId}
      />
    </div>
  )
}
