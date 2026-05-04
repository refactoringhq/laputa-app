import { useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { CaretDown, X } from '@phosphor-icons/react'
import type { FolderNode } from '../types'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface FolderPickerProps {
  /** Current vault-relative folder path. `null` means "use the default". */
  value: string | null
  onChange: (next: string | null) => void
  folders: FolderNode[]
  /** Placeholder shown when value is null (e.g. "attachments"). */
  placeholder?: string
  /** Optional className for the input. */
  className?: string
  /** ARIA label / id linking. */
  ariaLabel?: string
}

function flattenFolderPaths(folders: FolderNode[]): string[] {
  const out: string[] = []
  function visit(nodes: FolderNode[]) {
    for (const node of nodes) {
      out.push(node.path)
      if (node.children.length > 0) visit(node.children)
    }
  }
  visit(folders)
  return out.sort((a, b) => a.localeCompare(b))
}

function normalizeUserFolder(raw: string): string | null {
  const trimmed = raw.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!trimmed) return null
  if (trimmed.split('/').some((segment) => segment === '..' || segment === '.')) return null
  return trimmed
}

function filterMatchingFolders(folders: string[], query: string): string[] {
  const normalized = query.trim().toLowerCase().replace(/^\/+|\/+$/g, '')
  if (!normalized) return folders
  return folders.filter((folder) => folder.toLowerCase().includes(normalized))
}

interface FolderPickerHandlers {
  draft: string
  open: boolean
  matches: string[]
  inputRef: React.RefObject<HTMLInputElement | null>
  setOpen: (next: boolean | ((prev: boolean) => boolean)) => void
  handleChange: (event: ChangeEvent<HTMLInputElement>) => void
  handleBlur: () => void
  handleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  handleSelectMatch: (folder: string) => void
  handleClear: () => void
}

function useFolderPickerState(
  value: string | null,
  onChange: (next: string | null) => void,
  folders: FolderNode[],
): FolderPickerHandlers {
  const allFolderPaths = useMemo(() => flattenFolderPaths(folders), [folders])
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [lastSyncedValue, setLastSyncedValue] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  if (value !== lastSyncedValue) {
    setLastSyncedValue(value)
    setDraft(value ?? '')
  }

  const matches = useMemo(() => filterMatchingFolders(allFolderPaths, draft), [allFolderPaths, draft])

  const commit = (raw: string) => {
    const next = normalizeUserFolder(raw)
    onChange(next)
    setDraft(next ?? '')
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setDraft(event.target.value)
    if (!open) setOpen(true)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit(draft)
      setOpen(false)
      inputRef.current?.blur()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setDraft(value ?? '')
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  const handleBlur = () => commit(draft)

  const handleSelectMatch = (folder: string) => {
    commit(folder)
    setOpen(false)
    inputRef.current?.focus()
  }

  const handleClear = () => {
    onChange(null)
    setDraft('')
    inputRef.current?.focus()
  }

  return {
    draft, open, matches, inputRef, setOpen,
    handleChange, handleBlur, handleKeyDown, handleSelectMatch, handleClear,
  }
}

function preventMouseDown(event: React.MouseEvent<HTMLButtonElement>) {
  event.preventDefault()
}

function FolderMatchesList({
  matches,
  value,
  onSelect,
}: {
  matches: string[]
  value: string | null
  onSelect: (folder: string) => void
}) {
  if (matches.length === 0) {
    return <div className="px-2 py-1.5 text-xs text-muted-foreground">No matching folders</div>
  }
  return (
    <div role="listbox" className="flex flex-col">
      {matches.slice(0, 50).map((folder) => (
        <button
          key={folder}
          type="button"
          role="option"
          aria-selected={folder === value}
          onMouseDown={preventMouseDown}
          onClick={() => onSelect(folder)}
          className={cn(
            'block w-full truncate rounded-sm px-2 py-1 text-left text-sm hover:bg-accent hover:text-accent-foreground',
            folder === value && 'bg-accent/50',
          )}
        >
          {folder}
        </button>
      ))}
    </div>
  )
}

export function FolderPicker({
  value,
  onChange,
  folders,
  placeholder,
  className,
  ariaLabel,
}: FolderPickerProps) {
  const inputId = useId()
  const {
    draft, open, matches, inputRef, setOpen,
    handleChange, handleBlur, handleKeyDown, handleSelectMatch, handleClear,
  } = useFolderPickerState(value, onChange, folders)

  const handleToggle = () => {
    setOpen((prev) => !prev)
    inputRef.current?.focus()
  }

  return (
    <Popover open={open && matches.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className={cn('relative flex items-center', className)}>
          <Input
            id={inputId}
            ref={inputRef}
            value={draft}
            onChange={handleChange}
            onFocus={() => setOpen(true)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            aria-label={ariaLabel}
            spellCheck={false}
            autoComplete="off"
            className="pr-14"
          />
          {value && (
            <button
              type="button"
              onMouseDown={preventMouseDown}
              onClick={handleClear}
              className="absolute right-7 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              aria-label="Clear folder"
            >
              <X size={14} />
            </button>
          )}
          <button
            type="button"
            onMouseDown={preventMouseDown}
            onClick={handleToggle}
            className="absolute right-2 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            aria-label="Open folder list"
          >
            <CaretDown size={14} />
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="max-h-64 w-[var(--radix-popover-trigger-width)] overflow-auto p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <FolderMatchesList matches={matches} value={value} onSelect={handleSelectMatch} />
      </PopoverContent>
    </Popover>
  )
}
