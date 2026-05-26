import { useState, useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { formatShortcutDisplay } from '../hooks/appCommandCatalog'
import type { CommitMode } from '../hooks/useCommitFlow'
import { GitRepositorySelect } from './GitRepositorySelect'
import type { GitRepositoryOption } from '../utils/gitRepositories'
import { translate, type AppLocale } from '../lib/i18n'

type CommitDialogCopy = {
  title: string
  description: string
  actionLabel: string
  shortcutHint: string
}

function getDialogCopy(commitMode: CommitMode): CommitDialogCopy {
  const submitShortcut = formatShortcutDisplay({ display: '⌘↵' })

  if (commitMode === 'local') {
    return {
      title: 'Commit',
      description: 'This vault has no git remote configured. Tolaria will create a local commit only.',
      actionLabel: 'Commit',
      shortcutHint: `${submitShortcut} to commit locally`,
    }
  }

  return {
    title: 'Commit & Push',
    description: 'Review changed files and enter a commit message before committing and pushing.',
    actionLabel: 'Commit & Push',
    shortcutHint: `${submitShortcut} to commit`,
  }
}

function changedFilesLabel(modifiedCount: number): string {
  return `${modifiedCount} file${modifiedCount !== 1 ? 's' : ''} changed`
}

function isSubmitShortcut(event: React.KeyboardEvent): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey)
}

function isCloseShortcut(event: React.KeyboardEvent): boolean {
  return event.key === 'Escape'
}

interface CommitDialogProps {
  open: boolean
  modifiedCount: number
  commitMode?: CommitMode
  locale?: AppLocale
  repositories?: GitRepositoryOption[]
  selectedRepositoryPath?: string
  suggestedMessage?: string
  onRepositoryChange?: (path: string) => void
  onCommit: (message: string) => void
  onClose: () => void
}

export function CommitDialog({
  open,
  modifiedCount,
  commitMode = 'push',
  locale = 'en',
  repositories = [],
  selectedRepositoryPath = '',
  suggestedMessage,
  onRepositoryChange,
  onCommit,
  onClose,
}: CommitDialogProps) {
  const [message, setMessage] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const suggestedMessageRef = useRef(suggestedMessage)
  const copy = getDialogCopy(commitMode)

  useEffect(() => {
    suggestedMessageRef.current = suggestedMessage
  }, [suggestedMessage])

  useEffect(() => {
    if (open) {
      setMessage(suggestedMessageRef.current ?? '') // eslint-disable-line react-hooks/set-state-in-effect -- reset on dialog open
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const handleSubmit = () => {
    const trimmed = message.trim()
    if (!trimmed) return
    onCommit(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isSubmitShortcut(e)) {
      e.preventDefault()
      handleSubmit()
    } else if (isCloseShortcut(e)) {
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent showCloseButton={false} className="sm:max-w-[420px]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>{copy.title}</DialogTitle>
            <Badge variant="secondary" className="text-xs">
              {changedFilesLabel(modifiedCount)}
            </Badge>
          </div>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        {onRepositoryChange && selectedRepositoryPath && (
          <GitRepositorySelect
            label={translate(locale, 'git.repository.select')}
            repositories={repositories}
            selectedPath={selectedRepositoryPath}
            onChange={onRepositoryChange}
            testId="commit-repository-select"
          />
        )}
        <Textarea
          ref={inputRef}
          className="min-h-[84px] resize-y bg-[var(--bg-input)] py-2.5 text-[13px]"
          placeholder="Commit message..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
        />
        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          <span className="text-[11px] text-muted-foreground">{copy.shortcutHint}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!message.trim()}>
              {copy.actionLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
