import type { RefObject } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { translate, type AppLocale } from '../../lib/i18n'
import type { ChangeActionTarget, ChangesContextMenuState } from './NoteListChangesMenu'

function changeActionLabel(locale: AppLocale, action: ChangeActionTarget['action']): string {
  return translate(locale, action === 'restore' ? 'noteList.changes.restoreNote' : 'noteList.changes.discardChanges')
}

function changeConfirmLabel(locale: AppLocale, action: ChangeActionTarget['action']): string {
  return translate(locale, action === 'restore' ? 'noteList.changes.restore' : 'noteList.changes.discard')
}

function changeDialogDescription(locale: AppLocale, target: ChangeActionTarget): string {
  const file = target.action === 'restore'
    ? target.entry.filename
    : target.entry.title
  const key = target.action === 'restore'
    ? 'noteList.changes.restoreDescription'
    : 'noteList.changes.discardDescription'
  return translate(locale, key, { file: file ?? translate(locale, 'noteList.changes.thisFile') })
}

export function ChangesContextMenuNode({
  ctxMenu,
  ctxMenuRef,
  actionTarget,
  locale,
  onSelect,
}: {
  ctxMenu: ChangesContextMenuState | null
  ctxMenuRef: RefObject<HTMLDivElement | null>
  actionTarget: ChangeActionTarget | null
  locale: AppLocale
  onSelect: () => void
}) {
  if (!ctxMenu) return null

  return (
    <div
      ref={ctxMenuRef}
      className="fixed z-50 rounded-md border bg-popover p-1 shadow-md"
      style={{ left: ctxMenu.x, top: ctxMenu.y, minWidth: 180 }}
      data-testid="changes-context-menu"
    >
      <Button
        type="button"
        variant="ghost"
        className="flex h-auto w-full cursor-default items-center justify-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-destructive transition-colors hover:bg-accent hover:text-accent-foreground"
        onClick={onSelect}
        data-testid={actionTarget?.action === 'restore' ? 'restore-note-button' : 'discard-changes-button'}
      >
        {changeActionLabel(locale, actionTarget?.action ?? 'discard')}
      </Button>
    </div>
  )
}

export function ChangeConfirmDialog({
  actionTarget,
  locale,
  onCancel,
  onConfirm,
}: {
  actionTarget: ChangeActionTarget | null
  locale: AppLocale
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={!!actionTarget} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent
        showCloseButton={false}
        data-testid={actionTarget?.action === 'restore' ? 'restore-confirm-dialog' : 'discard-confirm-dialog'}
      >
        {actionTarget && (
          <>
            <DialogHeader>
              <DialogTitle>{changeActionLabel(locale, actionTarget.action)}</DialogTitle>
              <DialogDescription>{changeDialogDescription(locale, actionTarget)}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={onCancel}>{translate(locale, 'noteList.changes.cancel')}</Button>
              <Button
                variant={actionTarget.action === 'restore' ? 'default' : 'destructive'}
                onClick={onConfirm}
                data-testid={actionTarget.action === 'restore' ? 'restore-confirm-button' : 'discard-confirm-button'}
              >
                {changeConfirmLabel(locale, actionTarget.action)}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
