import {
  useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject,
} from 'react'
import {
  Palette, PencilSimple, Trash,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ViewDefinition, ViewFile } from '../../types'
import { translate, type AppLocale } from '../../lib/i18n'
import { TypeCustomizePopover } from '../TypeCustomizePopover'

export interface MenuPosition {
  x: number
  y: number
}

export type ViewDefinitionPatchHandler = (filename: string, patch: Partial<ViewDefinition>) => void

export function ViewRenameInput({
  initialValue,
  locale,
  onCancel,
  onSubmit,
}: {
  initialValue: string
  locale: AppLocale
  onCancel: () => void
  onSubmit: (value: string) => void
}) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      onSubmit(value)
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }
  }

  return (
    <Input
      ref={inputRef}
      aria-label={translate(locale, 'sidebar.view.name')}
      className="h-6 min-w-0 flex-1 rounded border-primary bg-background px-1.5 py-0 text-[13px] font-medium"
      value={value}
      onBlur={() => onSubmit(value)}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={handleKeyDown}
    />
  )
}

function ViewMenuButton({
  children,
  destructive = false,
  onClick,
}: {
  children: ReactNode
  destructive?: boolean
  onClick: () => void
}) {
  const className = `h-auto w-full justify-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm font-normal${destructive ? ' text-destructive hover:text-destructive' : ''}`
  return (
    <Button type="button" variant="ghost" size="sm" className={className} onClick={onClick}>
      {children}
    </Button>
  )
}

export function ViewContextMenu({
  pos,
  canCustomize,
  canDelete,
  canEdit,
  locale,
  innerRef,
  onCustomize,
  onDelete,
  onEdit,
  onRename,
}: {
  pos: MenuPosition | null
  canCustomize: boolean
  canDelete: boolean
  canEdit: boolean
  locale: AppLocale
  innerRef: RefObject<HTMLDivElement | null>
  onCustomize: () => void
  onDelete: () => void
  onEdit: () => void
  onRename: () => void
}) {
  if (!pos || (!canEdit && !canCustomize && !canDelete)) return null

  return (
    <div
      ref={innerRef}
      className="fixed z-50 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left: pos.x, top: pos.y, minWidth: 200 }}
    >
      {canEdit && (
        <ViewMenuButton onClick={onEdit}>
          <PencilSimple size={14} />
          {translate(locale, 'sidebar.action.editView')}
        </ViewMenuButton>
      )}
      {canCustomize && (
        <>
          <ViewMenuButton onClick={onRename}>
            <PencilSimple size={14} />
            {translate(locale, 'sidebar.action.renameView')}
          </ViewMenuButton>
          <ViewMenuButton onClick={onCustomize}>
            <Palette size={14} />
            {translate(locale, 'sidebar.action.customizeIconColor')}
          </ViewMenuButton>
        </>
      )}
      {canDelete && (
        <>
          <div className="my-1 h-px bg-border" role="separator" />
          <ViewMenuButton destructive onClick={onDelete}>
            <Trash size={14} />
            {translate(locale, 'sidebar.action.deleteView')}
          </ViewMenuButton>
        </>
      )}
    </div>
  )
}

export function ViewCustomizePanel({
  pos,
  view,
  locale,
  innerRef,
  onClose,
  onUpdateViewDefinition,
}: {
  pos: MenuPosition | null
  view: ViewFile
  locale: AppLocale
  innerRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  onUpdateViewDefinition?: ViewDefinitionPatchHandler
}) {
  if (!pos || !onUpdateViewDefinition) return null

  return (
    <div ref={innerRef} className="fixed z-50" style={{ left: pos.x, top: pos.y }}>
      <TypeCustomizePopover
        currentIcon={view.definition.icon}
        currentColor={view.definition.color}
        currentTemplate={null}
        onChangeIcon={(icon) => onUpdateViewDefinition(view.filename, { icon })}
        onChangeColor={(color) => onUpdateViewDefinition(view.filename, { color })}
        onChangeTemplate={() => {}}
        onClose={onClose}
        showTemplate={false}
        locale={locale}
      />
    </div>
  )
}
