import { CaretUpDown, Check, Cube } from '@phosphor-icons/react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { WorkspaceIdentity } from '../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { translate, type AppLocale } from '../lib/i18n'
import { PROPERTY_CHIP_STYLE } from './propertyChipStyles'
import {
  PROPERTY_PANEL_LABEL_CLASS_NAME,
  PROPERTY_PANEL_LABEL_ICON_SLOT_CLASS_NAME,
  PROPERTY_PANEL_ROW_STYLE,
} from './propertyPanelLayout'

const MIN_POPOVER_WIDTH = 220
const OPEN_COMBOBOX_KEYS = new Set(['ArrowDown', 'ArrowUp'])

interface WorkspaceSelectorProps {
  currentWorkspace?: WorkspaceIdentity | null
  locale?: AppLocale
  onChangeWorkspace?: (workspace: WorkspaceIdentity) => void | Promise<void>
  workspaces: WorkspaceIdentity[]
}

function normalizeWorkspaceQuery(query: string): string {
  return query.trim().toLowerCase()
}

function workspaceColor(workspace?: WorkspaceIdentity | null): string | undefined {
  return workspace?.color ? `var(--accent-${workspace.color})` : undefined
}

function workspaceLightColor(workspace?: WorkspaceIdentity | null): string | undefined {
  return workspace?.color ? `var(--accent-${workspace.color}-light)` : undefined
}

function uniqueWorkspaceOptions(
  workspaces: WorkspaceIdentity[],
  currentWorkspace?: WorkspaceIdentity | null,
): WorkspaceIdentity[] {
  const byPath = new Map<string, WorkspaceIdentity>()
  for (const workspace of workspaces) {
    if (workspace.available === false || workspace.mounted === false) continue
    byPath.set(workspace.path, workspace)
  }
  if (currentWorkspace) byPath.set(currentWorkspace.path, currentWorkspace)
  return [...byPath.values()].sort((left, right) => left.label.localeCompare(right.label))
}

function buildWorkspaceOptions({
  currentWorkspace,
  query,
  workspaces,
}: {
  currentWorkspace?: WorkspaceIdentity | null
  query: string
  workspaces: WorkspaceIdentity[]
}): WorkspaceIdentity[] {
  const normalizedQuery = normalizeWorkspaceQuery(query)
  return uniqueWorkspaceOptions(workspaces, currentWorkspace).filter((workspace) => {
    if (normalizedQuery === '') return true
    return workspace.label.toLowerCase().includes(normalizedQuery)
      || workspace.alias.toLowerCase().includes(normalizedQuery)
  })
}

function initialHighlightedIndex({
  currentWorkspace,
  options,
}: {
  currentWorkspace?: WorkspaceIdentity | null
  options: WorkspaceIdentity[]
}): number {
  if (options.length === 0) return -1
  const currentIndex = options.findIndex((workspace) => workspace.path === currentWorkspace?.path)
  return currentIndex >= 0 ? currentIndex : 0
}

function stepHighlightedIndex(current: number, optionsLength: number, direction: 'next' | 'previous') {
  if (optionsLength === 0) return -1
  if (current < 0) return direction === 'next' ? 0 : optionsLength - 1
  return direction === 'next'
    ? (current + 1) % optionsLength
    : (current - 1 + optionsLength) % optionsLength
}

function shouldOpenCombobox(event: KeyboardEvent<HTMLButtonElement>) {
  return OPEN_COMBOBOX_KEYS.has(event.key)
}

function reportWorkspaceChangeFailure(error: unknown) {
  console.error('Failed to change workspace:', error)
}

function WorkspaceRowLabel({ locale }: { locale: AppLocale }) {
  return (
    <span className={PROPERTY_PANEL_LABEL_CLASS_NAME}>
      <span
        className={PROPERTY_PANEL_LABEL_ICON_SLOT_CLASS_NAME}
        data-testid="workspace-row-icon-slot"
      >
        <Cube size={14} className="shrink-0" data-testid="workspace-row-icon" />
      </span>
      <span className="min-w-0 truncate">{translate(locale, 'inspector.properties.workspace')}</span>
    </span>
  )
}

function WorkspaceSelectorValue({
  currentWorkspace,
  locale,
}: {
  currentWorkspace?: WorkspaceIdentity | null
  locale: AppLocale
}) {
  if (!currentWorkspace) {
    return <span className="truncate text-muted-foreground">{translate(locale, 'inspector.properties.none')}</span>
  }
  return <span className="min-w-0 truncate">{currentWorkspace.label}</span>
}

function ReadOnlyWorkspaceSelector({
  currentWorkspace,
  locale,
}: {
  currentWorkspace?: WorkspaceIdentity | null
  locale: AppLocale
}) {
  if (!currentWorkspace) return null
  return (
    <div className="grid min-h-7 min-w-0 grid-cols-2 items-center gap-2 px-1.5" style={PROPERTY_PANEL_ROW_STYLE}>
      <WorkspaceRowLabel locale={locale} />
      <span
        className="min-w-0 max-w-full truncate text-[12px] font-medium"
        style={{
          ...PROPERTY_CHIP_STYLE,
          background: workspaceLightColor(currentWorkspace) ?? 'var(--muted)',
          color: workspaceColor(currentWorkspace) ?? 'var(--secondary-foreground)',
          display: 'inline-flex',
          alignItems: 'center',
        }}
        title={currentWorkspace.label}
      >
        {currentWorkspace.label}
      </span>
    </div>
  )
}

export function WorkspaceSelector({
  currentWorkspace,
  locale = 'en',
  onChangeWorkspace,
  workspaces,
}: WorkspaceSelectorProps) {
  const optionsForVisibility = useMemo(
    () => uniqueWorkspaceOptions(workspaces, currentWorkspace),
    [currentWorkspace, workspaces],
  )

  if (!currentWorkspace || optionsForVisibility.length <= 1) return null
  if (!onChangeWorkspace) {
    return <ReadOnlyWorkspaceSelector currentWorkspace={currentWorkspace} locale={locale} />
  }

  return (
    <EditableWorkspaceSelector
      currentWorkspace={currentWorkspace}
      locale={locale}
      onChangeWorkspace={onChangeWorkspace}
      workspaces={optionsForVisibility}
    />
  )
}

function EditableWorkspaceSelector({
  currentWorkspace,
  locale,
  onChangeWorkspace,
  workspaces,
}: {
  currentWorkspace: WorkspaceIdentity
  locale: AppLocale
  onChangeWorkspace: (workspace: WorkspaceIdentity) => void | Promise<void>
  workspaces: WorkspaceIdentity[]
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [contentWidth, setContentWidth] = useState(MIN_POPOVER_WIDTH)
  const rootRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const options = useMemo(
    () => buildWorkspaceOptions({ currentWorkspace, query, workspaces }),
    [currentWorkspace, query, workspaces],
  )

  useEffect(() => {
    if (!open) return

    const updateWidth = () => {
      const nextWidth = rootRef.current?.getBoundingClientRect().width ?? MIN_POPOVER_WIDTH
      setContentWidth(Math.max(nextWidth, MIN_POPOVER_WIDTH))
    }

    updateWidth()
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    window.addEventListener('resize', updateWidth)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', updateWidth)
    }
  }, [open])

  const openCombobox = () => {
    const nextOptions = buildWorkspaceOptions({ currentWorkspace, query: '', workspaces })
    setQuery('')
    setHighlightedIndex(initialHighlightedIndex({ currentWorkspace, options: nextOptions }))
    setOpen(true)
  }

  const closeCombobox = () => {
    setOpen(false)
    setQuery('')
    setHighlightedIndex(-1)
  }

  const selectWorkspace = (workspace: WorkspaceIdentity) => {
    if (workspace.path !== currentWorkspace.path) {
      void Promise.resolve(onChangeWorkspace(workspace)).catch(reportWorkspaceChangeFailure)
    }
    closeCombobox()
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      openCombobox()
      return
    }
    closeCombobox()
  }

  const scrollHighlightedOptionIntoView = (index: number) => {
    if (index < 0) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  const moveHighlight = (direction: 'next' | 'previous') => {
    setHighlightedIndex((current) => {
      const nextIndex = stepHighlightedIndex(current, options.length, direction)
      scrollHighlightedOptionIntoView(nextIndex)
      return nextIndex
    })
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!shouldOpenCombobox(event)) return
    event.preventDefault()
    openCombobox()
  }

  const handleSearchChange = (nextQuery: string) => {
    const nextOptions = buildWorkspaceOptions({ currentWorkspace, query: nextQuery, workspaces })
    setQuery(nextQuery)
    setHighlightedIndex(nextOptions.length > 0 ? 0 : -1)
  }

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        moveHighlight('next')
        return
      case 'ArrowUp':
        event.preventDefault()
        moveHighlight('previous')
        return
      case 'Enter': {
        const selected = options.at(highlightedIndex)
        if (!selected) return
        event.preventDefault()
        selectWorkspace(selected)
        return
      }
      case 'Escape':
        event.preventDefault()
        closeCombobox()
        return
      default:
        return
    }
  }

  return (
    <div
      className="grid min-h-7 min-w-0 grid-cols-2 items-center gap-2 px-1.5"
      style={PROPERTY_PANEL_ROW_STYLE}
      data-testid="workspace-selector"
    >
      <WorkspaceRowLabel locale={locale} />
      <div className="flex min-w-0 items-center justify-start">
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <Button
              ref={rootRef}
              type="button"
              variant="ghost"
              size="sm"
              role="combobox"
              aria-label={currentWorkspace.label}
              aria-controls={listboxId}
              aria-expanded={open}
              aria-haspopup="listbox"
              className={cn(
                'h-auto max-w-full justify-between gap-1 border-none px-2 shadow-none ring-inset [&_svg]:text-current',
                'hover:ring-1 hover:ring-current',
              )}
              style={{
                ...PROPERTY_CHIP_STYLE,
                background: workspaceLightColor(currentWorkspace) ?? undefined,
                color: workspaceColor(currentWorkspace) ?? undefined,
              }}
              onKeyDown={handleTriggerKeyDown}
            >
              <span className="flex min-w-0 items-center truncate">
                <WorkspaceSelectorValue currentWorkspace={currentWorkspace} locale={locale} />
              </span>
              <CaretUpDown size={14} aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="left"
            sideOffset={4}
            className="overflow-hidden p-1"
            style={{ width: contentWidth }}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <div className="border-b border-border p-1">
              <Input
                ref={inputRef}
                value={query}
                placeholder={translate(locale, 'inspector.properties.searchWorkspaces')}
                autoComplete="off"
                aria-label={translate(locale, 'inspector.properties.searchWorkspaces')}
                className="h-8 text-sm"
                data-testid="workspace-selector-search-input"
                onChange={(event) => handleSearchChange(event.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
            </div>
            <div ref={listRef} className="max-h-60 overflow-y-auto p-1">
              {options.length === 0 ? (
                <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                  {translate(locale, 'inspector.properties.noMatchingWorkspaces')}
                </div>
              ) : (
                <div id={listboxId} role="listbox">
                  {options.map((workspace, index) => {
                    const selected = workspace.path === currentWorkspace.path
                    const highlighted = index === highlightedIndex
                    return (
                      <Button
                        key={workspace.path}
                        type="button"
                        variant="ghost"
                        size="sm"
                        role="option"
                        aria-selected={selected}
                        data-index={index}
                        className={cn(
                          'h-auto w-full justify-between px-2 py-1.5 text-left font-normal',
                          highlighted && 'bg-muted',
                        )}
                        onMouseEnter={() => setHighlightedIndex(index)}
                        onClick={() => selectWorkspace(workspace)}
                      >
                        <span className="min-w-0 truncate">{workspace.label}</span>
                        {selected ? <Check size={14} aria-hidden="true" /> : null}
                      </Button>
                    )
                  })}
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
