import { Check, CircleNotch as Loader2, FileText, Warning as AlertTriangle } from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ConflictFileState } from '../hooks/useConflictResolver'
import { cn } from '@/lib/utils'

type ConflictResolutionStrategy = 'ours' | 'theirs'
type ConflictResolution = NonNullable<ConflictFileState['resolution']>

const BINARY_FILE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.mp3',
  '.mp4',
  '.wav',
  '.ogg',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
]

const RESOLUTION_LABELS: Record<ConflictResolution, string> = {
  manual: 'Edited manually',
  ours: 'Keeping mine',
  theirs: 'Keeping theirs',
}
const RESOLUTION_LABELS_BY_VALUE = new Map<ConflictResolution, string>(
  Object.entries(RESOLUTION_LABELS) as Array<[ConflictResolution, string]>,
)

const RESOLUTION_SHORTCUTS: Record<string, ConflictResolutionStrategy | undefined> = {
  k: 'ours',
  t: 'theirs',
}

interface ConflictResolverModalProps {
  open: boolean
  fileStates: ConflictFileState[]
  allResolved: boolean
  committing: boolean
  error: string | null
  onResolveFile: (file: string, strategy: 'ours' | 'theirs') => void
  onOpenInEditor: (file: string) => void
  onCommit: () => void
  onClose: () => void
}

function isBinaryFile(file: string): boolean {
  const normalizedFile = file.toLowerCase()
  return BINARY_FILE_EXTENSIONS.some(ext => normalizedFile.endsWith(ext))
}

function fileName(path: string): string {
  return path.split('/').pop() ?? path
}

function ResolutionLabel({ resolution }: { resolution: ConflictFileState['resolution'] }) {
  if (!resolution) return null
  return (
    <span className="flex items-center gap-1 text-xs text-[var(--feedback-success-text)]">
      <Check size={12} />{RESOLUTION_LABELS_BY_VALUE.get(resolution)}
    </span>
  )
}

function ConflictFileRow({
  state,
  focused,
  onResolve,
  onOpenInEditor,
  onFocus,
}: {
  state: ConflictFileState
  focused: boolean
  onResolve: (strategy: 'ours' | 'theirs') => void
  onOpenInEditor: () => void
  onFocus: () => void
}) {
  const rowRef = useRef<HTMLTableRowElement>(null)
  const binary = isBinaryFile(state.file)
  const resolved = state.resolution !== null

  useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [focused])

  return (
    <tr
      ref={rowRef}
      tabIndex={0}
      onFocus={onFocus}
      className={cn(
        'flex items-center justify-between gap-2 rounded-md border px-3 py-2 transition-colors',
        focused ? 'border-ring bg-accent/50' : 'border-border bg-background',
        resolved && 'opacity-70',
      )}
      data-testid={`conflict-file-${state.file}`}
    >
      <td className="flex min-w-0 flex-1 items-center gap-2">
        <FileText size={14} className="shrink-0 text-muted-foreground" />
        <span className="text-sm truncate" title={state.file}>{fileName(state.file)}</span>
        <ResolutionLabel resolution={state.resolution} />
      </td>
      <td className="flex shrink-0 items-center gap-1">
        {state.resolving ? (
          <Loader2 size={14} className="animate-spin text-muted-foreground" />
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 px-2"
              onClick={() => onResolve('ours')}
              disabled={state.resolving}
              title="Keep my local version (K)"
              data-testid={`resolve-ours-${state.file}`}
            >
              Keep mine
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 px-2"
              onClick={() => onResolve('theirs')}
              disabled={state.resolving}
              title="Keep remote version (T)"
              data-testid={`resolve-theirs-${state.file}`}
            >
              Keep theirs
            </Button>
            {!binary && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7 px-2"
                onClick={onOpenInEditor}
                title="Open file in editor (O)"
                data-testid={`resolve-open-${state.file}`}
              >
                Open in editor
              </Button>
            )}
          </>
        )}
      </td>
    </tr>
  )
}

function clampFocusIndex(index: number, fileCount: number): number {
  if (fileCount === 0) return 0
  return Math.min(Math.max(index, 0), fileCount - 1)
}

function useConflictFocus(fileCount: number) {
  const [focusIdx, setFocusIdx] = useState(0)
  const focusIdxRef = useRef(0)
  const visibleFocusIdx = clampFocusIndex(focusIdx, fileCount)

  const syncFocusIdx = useCallback((nextIndex: number) => {
    const clampedIndex = clampFocusIndex(nextIndex, fileCount)
    setFocusIdx(clampedIndex)
    focusIdxRef.current = clampedIndex
  }, [fileCount])

  const moveFocus = useCallback((offset: number) => {
    const currentIndex = clampFocusIndex(focusIdxRef.current, fileCount)
    syncFocusIdx(currentIndex + offset)
  }, [fileCount, syncFocusIdx])

  return {
    focusIdx: visibleFocusIdx,
    focusIdxRef,
    moveFocus,
    syncFocusIdx,
  }
}

function hasCommandModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey
}

function isNextRowKey(event: KeyboardEvent): boolean {
  if (event.key === 'ArrowDown') return true
  return event.key === 'Tab' && !event.shiftKey
}

function isPreviousRowKey(event: KeyboardEvent): boolean {
  if (event.key === 'ArrowUp') return true
  return event.key === 'Tab' && event.shiftKey
}

function handleNavigationKey(event: KeyboardEvent, moveFocus: (offset: number) => void): boolean {
  if (isNextRowKey(event)) {
    event.preventDefault()
    moveFocus(1)
    return true
  }

  if (isPreviousRowKey(event)) {
    event.preventDefault()
    moveFocus(-1)
    return true
  }

  return false
}

function handleResolutionShortcut(
  event: KeyboardEvent,
  file: ConflictFileState | undefined,
  onResolveFile: ConflictResolverModalProps['onResolveFile'],
): boolean {
  const strategy = RESOLUTION_SHORTCUTS[event.key.toLowerCase()]
  if (!strategy || !file || file.resolving || hasCommandModifier(event)) return false

  event.preventDefault()
  onResolveFile(file.file, strategy)
  return true
}

function handleOpenShortcut(
  event: KeyboardEvent,
  file: ConflictFileState | undefined,
  onOpenInEditor: ConflictResolverModalProps['onOpenInEditor'],
): boolean {
  if (event.key.toLowerCase() !== 'o' || !file || file.resolving || hasCommandModifier(event)) return false
  if (isBinaryFile(file.file)) return false

  event.preventDefault()
  onOpenInEditor(file.file)
  return true
}

function handleCommitShortcut({
  allResolved,
  committing,
  event,
  onCommit,
}: {
  allResolved: boolean
  committing: boolean
  event: KeyboardEvent
  onCommit: ConflictResolverModalProps['onCommit']
}): boolean {
  if (event.key !== 'Enter' || !allResolved || committing) return false

  event.preventDefault()
  onCommit()
  return true
}

function ConflictDialogHeader({ fileCount }: { fileCount: number }) {
  return (
    <DialogHeader>
      <div className="flex items-center gap-2">
        <AlertTriangle size={18} className="text-[var(--accent-orange)]" />
        <DialogTitle>Resolve Merge Conflicts</DialogTitle>
      </div>
      <DialogDescription>
        {fileCount} file{fileCount !== 1 ? 's have' : ' has'} merge conflicts. Choose how to resolve each file.
      </DialogDescription>
    </DialogHeader>
  )
}

function ConflictFileList({
  fileStates,
  focusIdx,
  onFocusRow,
  onOpenInEditor,
  onResolveFile,
}: {
  fileStates: ConflictFileState[]
  focusIdx: number
  onFocusRow: (index: number) => void
  onOpenInEditor: (file: string) => void
  onResolveFile: (file: string, strategy: ConflictResolutionStrategy) => void
}) {
  return (
    <table
      className="block max-h-[300px] overflow-y-auto"
      data-testid="conflict-file-list"
    >
      <tbody className="flex flex-col gap-2">
        {fileStates.map((state, index) => (
          <ConflictFileRow
            key={state.file}
            state={state}
            focused={index === focusIdx}
            onResolve={(strategy) => onResolveFile(state.file, strategy)}
            onOpenInEditor={() => onOpenInEditor(state.file)}
            onFocus={() => onFocusRow(index)}
          />
        ))}
      </tbody>
    </table>
  )
}

function CommitButtonContent({ committing }: { committing: boolean }) {
  if (!committing) return 'Commit & continue'
  return (
    <>
      <Loader2 size={14} className="animate-spin mr-1" />Committing…
    </>
  )
}

function ConflictDialogFooter({
  allResolved,
  committing,
  onClose,
  onCommit,
}: {
  allResolved: boolean
  committing: boolean
  onClose: () => void
  onCommit: () => void
}) {
  return (
    <DialogFooter className="flex-row items-center justify-between sm:justify-between">
      <span className="text-[11px] text-muted-foreground">
        K = keep mine · T = keep theirs · O = open · Enter = commit
      </span>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button
          onClick={onCommit}
          disabled={!allResolved || committing}
          data-testid="conflict-commit-btn"
        >
          <CommitButtonContent committing={committing} />
        </Button>
      </div>
    </DialogFooter>
  )
}

export function ConflictResolverModal({
  open,
  onClose,
  ...contentProps
}: ConflictResolverModalProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      {open ? (
        <ConflictResolverDialogContent
          open={open}
          onClose={onClose}
          {...contentProps}
        />
      ) : null}
    </Dialog>
  )
}

function ConflictResolverDialogContent({
  fileStates,
  allResolved,
  committing,
  error,
  onResolveFile,
  onOpenInEditor,
  onCommit,
  onClose,
}: ConflictResolverModalProps) {
  const {
    focusIdx,
    focusIdxRef,
    moveFocus,
    syncFocusIdx,
  } = useConflictFocus(fileStates.length)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
      return
    }

    if (handleNavigationKey(e, moveFocus)) return

    const focusedIndex = clampFocusIndex(focusIdxRef.current, fileStates.length)
    const file = fileStates.at(focusedIndex)
    if (handleResolutionShortcut(e, file, onResolveFile)) return
    if (handleOpenShortcut(e, file, onOpenInEditor)) return
    handleCommitShortcut({ allResolved, committing, event: e, onCommit })
  }, [allResolved, committing, fileStates, focusIdxRef, moveFocus, onClose, onCommit, onOpenInEditor, onResolveFile])

  return (
    <DialogContent
      showCloseButton={false}
      className="sm:max-w-[520px]"
      onKeyDown={handleKeyDown}
    >
      <ConflictDialogHeader fileCount={fileStates.length} />

      <ConflictFileList
        fileStates={fileStates}
        focusIdx={focusIdx}
        onFocusRow={syncFocusIdx}
        onOpenInEditor={onOpenInEditor}
        onResolveFile={onResolveFile}
      />

      {error && (
        <p className="text-xs text-destructive" data-testid="conflict-error">{error}</p>
      )}

      <ConflictDialogFooter
        allResolved={allResolved}
        committing={committing}
        onClose={onClose}
        onCommit={onCommit}
      />
    </DialogContent>
  )
}
