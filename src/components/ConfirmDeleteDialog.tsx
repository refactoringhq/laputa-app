import { memo, useCallback, useEffect, useRef } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Trash } from '@phosphor-icons/react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface ConfirmDeleteDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

function focusConfirmButton(confirmButton: HTMLButtonElement | null) {
  confirmButton?.focus()
}

function focusPrimaryDeleteButton(root: ParentNode | null) {
  focusConfirmButton(root?.querySelector<HTMLButtonElement>('[data-confirm-delete-primary="true"]') ?? null)
}

function scheduleConfirmButtonFocus(root: ParentNode | null) {
  const focusDelays = [0, 50, 150]
  return focusDelays.map((delay) => (
    window.setTimeout(() => {
      focusPrimaryDeleteButton(root)
    }, delay)
  ))
}

type ConfirmShortcutEvent = Pick<
  KeyboardEvent,
  'key' | 'defaultPrevented' | 'repeat' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
> & {
  isComposing?: boolean
  nativeEvent?: Pick<KeyboardEvent, 'isComposing'>
}

function isComposingEvent(event: ConfirmShortcutEvent) {
  return event.isComposing || event.nativeEvent?.isComposing === true
}

function isConfirmShortcut(event: ConfirmShortcutEvent) {
  return (
    event.key === 'Enter'
    && !event.defaultPrevented
    && !event.repeat
    && !event.metaKey
    && !event.ctrlKey
    && !event.altKey
    && !event.shiftKey
    && !isComposingEvent(event)
  )
}

export const ConfirmDeleteDialog = memo(function ConfirmDeleteDialog({ open, title, message, confirmLabel = 'Delete permanently', onConfirm, onCancel }: ConfirmDeleteDialogProps) {
  const confirmingRef = useRef(false)
  const cancelFocusIsIntentionalRef = useRef(false)

  useEffect(() => {
    confirmingRef.current = false
    cancelFocusIsIntentionalRef.current = false
    if (!open) {
      return
    }

    focusPrimaryDeleteButton(document)
    const timeoutIds = scheduleConfirmButtonFocus(document)

    return () => {
      timeoutIds.forEach((timeoutId) => {
        window.clearTimeout(timeoutId)
      })
    }
  }, [open])

  const handleConfirm = useCallback(() => {
    if (confirmingRef.current) {
      return
    }

    confirmingRef.current = true
    onConfirm()
  }, [onConfirm])

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    handleConfirm()
  }, [handleConfirm])

  useEffect(() => {
    if (!open) {
      return
    }

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (!isConfirmShortcut(event)) {
        return
      }

      event.preventDefault()
      handleConfirm()
    }

    window.addEventListener('keydown', handleWindowKeyDown, true)

    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown, true)
    }
  }, [handleConfirm, open])

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isConfirmShortcut(event)) {
      return
    }

    event.preventDefault()
    handleConfirm()
  }, [handleConfirm])

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel() }}>
      <DialogContent
        showCloseButton={false}
        data-testid="confirm-delete-dialog"
        onKeyDown={handleKeyDown}
        onKeyDownCapture={(event) => {
          if (event.key === 'Tab') {
            cancelFocusIsIntentionalRef.current = true
          }
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          const dialogRoot = event.currentTarget as ParentNode | null
          focusPrimaryDeleteButton(dialogRoot)
          scheduleConfirmButtonFocus(dialogRoot)
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash size={18} className="text-destructive" />
            {title}
          </DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogFooter>
            <Button type="submit" variant="destructive" data-testid="confirm-delete-btn" data-confirm-delete-primary="true" autoFocus>
              {confirmLabel}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              onFocus={() => {
                if (cancelFocusIsIntentionalRef.current) {
                  return
                }

                focusPrimaryDeleteButton(document)
              }}
              onPointerDown={() => {
                cancelFocusIsIntentionalRef.current = true
              }}
              data-confirm-delete-cancel="true"
              tabIndex={-1}
            >
              Cancel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
})
