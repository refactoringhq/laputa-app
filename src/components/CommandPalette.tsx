import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { VaultEntry } from '../types'
import { fuzzyMatch } from '../utils/fuzzyMatch'
import { queueAiPrompt, requestOpenAiChat } from '../utils/aiPromptBridge'
import type { NoteReference } from '../utils/ai-context'
import type { CommandAction, CommandGroup } from '../hooks/useCommandRegistry'
import { groupSortKey } from '../hooks/useCommandRegistry'
import { localizeCommandGroup } from '../hooks/commands/localizeCommands'
import { rememberFeedbackDialogOpener } from '../lib/feedbackDialogOpener'
import { createTranslator, type AppLocale } from '../lib/i18n'
import { formatDroppedPathList } from './inlineWikilinkDropText'
import { CommandPaletteAiMode } from './CommandPaletteAiMode'
import { Input } from './ui/input'
import { useNativePathDrop } from './useNativePathDrop'

interface CommandPaletteProps {
  open: boolean
  commands: CommandAction[]
  entries?: VaultEntry[]
  claudeCodeReady?: boolean
  aiAgentReady?: boolean
  aiAgentLabel?: string
  locale?: AppLocale
  onClose: () => void
}

interface ScoredCommand {
  command: CommandAction
  score: number
}

function focusPaletteTarget(target: HTMLInputElement | HTMLDivElement | null) {
  if (!target) return

  target.focus()

  if (!(target instanceof HTMLDivElement)) return

  const selection = window.getSelection()
  if (!selection) return

  const range = document.createRange()
  range.selectNodeContents(target)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

function matchCommand(query: string, command: CommandAction): ScoredCommand | null {
  const labelResult = fuzzyMatch(query, command.label)
  if (labelResult.match) return { command, score: labelResult.score }

  for (const keyword of command.keywords ?? []) {
    const keywordResult = fuzzyMatch(query, keyword)
    if (keywordResult.match) return { command, score: keywordResult.score - 1 }
  }

  const groupResult = fuzzyMatch(query, command.group)
  if (groupResult.match) return { command, score: groupResult.score - 2 }

  return null
}

function groupResults(
  commands: CommandAction[],
  byRelevance: boolean,
): { group: CommandGroup; items: CommandAction[] }[] {
  const groupedCommands = new Map<CommandGroup, CommandAction[]>()

  for (const command of commands) {
    const existing = groupedCommands.get(command.group)
    if (existing) {
      existing.push(command)
      continue
    }
    groupedCommands.set(command.group, [command])
  }

  const entries = Array.from(groupedCommands.entries())
  if (!byRelevance) {
    entries.sort((left, right) => groupSortKey(left[0]) - groupSortKey(right[0]))
  }

  return entries.map(([group, items]) => ({ group, items }))
}

function usePaletteResults(commands: CommandAction[], query: string) {
  const enabledCommands = useMemo(
    () => commands.filter((command) => command.enabled),
    [commands],
  )

  const filteredCommands = useMemo(() => {
    if (!query.trim()) return enabledCommands
    return enabledCommands
      .map((command) => matchCommand(query, command))
      .filter((result): result is ScoredCommand => result !== null)
      .sort((left, right) => right.score - left.score)
      .map((result) => result.command)
  }, [enabledCommands, query])

  const hasQuery = query.trim().length > 0
  const groups = useMemo(
    () => groupResults(filteredCommands, hasQuery),
    [filteredCommands, hasQuery],
  )

  return {
    groups,
    flatList: groups.flatMap((group) => group.items),
  }
}

function rememberCommandOpener(
  command: CommandAction,
  target: HTMLInputElement | HTMLDivElement | null,
) {
  if (command.id !== 'open-contribute') return
  rememberFeedbackDialogOpener(target instanceof HTMLElement ? target : null)
}

function inputSelectionRange(input: HTMLInputElement, fallbackIndex: number) {
  const start = input.selectionStart ?? fallbackIndex
  const end = input.selectionEnd ?? start
  return {
    start: Math.max(0, start),
    end: Math.max(start, end),
  }
}

function CommandPaletteInput({
  inputRef,
  query,
  onChange,
  placeholder,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  query: string
  onChange: (value: string) => void
  placeholder: string
}) {
  const insertNativePathDrop = (paths: string[]) => {
    const droppedPathText = formatDroppedPathList(paths)
    const input = inputRef.current
    if (!droppedPathText || !input) return

    const { start, end } = inputSelectionRange(input, query.length)
    const nextValue = `${query.slice(0, start)}${droppedPathText}${query.slice(end)}`
    const nextCursor = start + droppedPathText.length

    onChange(nextValue)
    window.requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(nextCursor, nextCursor)
    })
  }

  useNativePathDrop({
    targetRef: inputRef,
    onPathDrop: insertNativePathDrop,
  })

  return (
    <Input
      ref={inputRef}
      className="h-auto rounded-none border-x-0 border-t-0 border-b border-border bg-transparent px-4 py-3 text-[15px] text-foreground shadow-none transition-none outline-none placeholder:text-muted-foreground focus-visible:border-border focus-visible:ring-0 md:text-[15px]"
      type="text"
      placeholder={placeholder}
      value={query}
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      autoComplete="off"
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

function CommandPaletteResults({
  groups,
  selectedIndex,
  listRef,
  emptyText,
  locale,
  onHover,
  onSelect,
}: {
  groups: { group: CommandGroup; items: CommandAction[] }[]
  selectedIndex: number
  listRef: React.RefObject<HTMLDivElement | null>
  emptyText: string
  locale: AppLocale
  onHover: (index: number) => void
  onSelect: (command: CommandAction) => void
}) {
  const flatList = groups.flatMap((group) => group.items)

  if (flatList.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto py-1" ref={listRef}>
        <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
          {emptyText}
        </div>
      </div>
    )
  }

  const sections = groups.reduce<Array<{ group: CommandGroup; items: CommandAction[]; startIndex: number }>>(
    (acc, group) => {
      const previous = acc.at(-1)
      acc.push({
        ...group,
        startIndex: previous ? previous.startIndex + previous.items.length : 0,
      })
      return acc
    },
    [],
  )

  return (
    <div className="flex-1 overflow-y-auto py-1" ref={listRef}>
      {sections.map(({ group, items, startIndex }) => {
        return (
          <div key={group}>
            <div className="px-4 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">
              {localizeCommandGroup(group, locale)}
            </div>
            {items.map((command, index) => {
              const globalIndex = startIndex + index
              return (
                <CommandRow
                  key={command.id}
                  command={command}
                  selected={globalIndex === selectedIndex}
                  onHover={() => onHover(globalIndex)}
                  onSelect={() => onSelect(command)}
                />
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function CommandPaletteFooter({
  aiMode,
  aiAgentLabel = 'Claude Code',
  footerText,
}: {
  aiMode: boolean
  aiAgentLabel?: string
  footerText: {
    aiMode: string
    navigate: string
    select: string
    send: string
    close: string
  }
}) {
  return (
    <div className="flex items-center gap-4 border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground">
      <span>{aiMode ? footerText.aiMode.replace('{agent}', aiAgentLabel) : footerText.navigate}</span>
      <span>{aiMode ? footerText.send : footerText.select}</span>
      <span>{footerText.close}</span>
    </div>
  )
}

export function CommandPalette({ open, ...props }: CommandPaletteProps) {
  if (!open) return null
  return <OpenCommandPalette {...props} />
}

function OpenCommandPalette({
  commands,
  entries = [],
  claudeCodeReady = true,
  aiAgentReady,
  aiAgentLabel = 'Claude Code',
  locale = 'en',
  onClose,
}: Omit<CommandPaletteProps, 'open'>) {
  const [query, setQuery] = useState('')
  const [aiValue, setAiValue] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const aiInputRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const aiMode = aiValue.startsWith(' ')
  const resolvedAiAgentReady = aiAgentReady ?? claudeCodeReady
  const { groups, flatList } = usePaletteResults(commands, query)
  const t = createTranslator(locale)
  const footerText = {
    aiMode: t('command.aiMode', { agent: '{agent}' }),
    navigate: t('command.footerNavigate'),
    select: t('command.footerSelect'),
    send: t('command.footerSend'),
    close: t('command.footerClose'),
  }

  useLayoutEffect(() => {
    const target = aiMode ? aiInputRef.current : inputRef.current
    if (!target) return

    focusPaletteTarget(target)
    if (document.activeElement === target) return

    const focusRetry = window.requestAnimationFrame(() => {
      focusPaletteTarget(target)
    })
    return () => window.cancelAnimationFrame(focusRetry)
  }, [aiMode])

  useEffect(() => {
    if (aiMode || !listRef.current) return
    const selectedElement = listRef.current.querySelector('[data-selected="true"]') as HTMLElement | null
    selectedElement?.scrollIntoView({ block: 'nearest' })
  }, [aiMode, selectedIndex])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (aiMode) return

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedIndex((current) => Math.min(current + 1, flatList.length - 1))
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedIndex((current) => Math.max(current - 1, 0))
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        const command = flatList[selectedIndex]
        if (!command) return
        rememberCommandOpener(command, inputRef.current)
        onClose()
        command.execute()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [aiMode, flatList, onClose, selectedIndex])

  const handleQueryChange = (nextQuery: string) => {
    setSelectedIndex(0)
    if (nextQuery.startsWith(' ')) {
      setAiValue(nextQuery)
      setQuery('')
      return
    }

    setQuery(nextQuery)
  }

  const handleAiValueChange = (nextValue: string) => {
    setSelectedIndex(0)
    if (nextValue.startsWith(' ')) {
      setAiValue(nextValue)
      return
    }

    setAiValue('')
    setQuery(nextValue)
  }

  const handleSelectCommand = (command: CommandAction) => {
    rememberCommandOpener(command, inputRef.current)
    onClose()
    command.execute()
  }

  const handleSubmitAiPrompt = (text: string, references: NoteReference[]) => {
    if (!text.trim()) {
      onClose()
      return
    }

    if (!resolvedAiAgentReady) return

    queueAiPrompt(text, references)
    requestOpenAiChat()
    onClose()
  }

  return (
    <div
      data-command-palette="true"
      className="fixed inset-0 z-[1000] flex justify-center bg-[var(--shadow-dialog)] pt-[15vh]"
      onClick={onClose}
    >
      <div
        className={cn(
          'flex w-[520px] max-h-[440px] max-w-[90vw] flex-col self-start overflow-hidden rounded-xl border border-[var(--border-dialog)] bg-popover shadow-[0_8px_32px_var(--shadow-dialog)]',
          aiMode && 'min-h-[220px]',
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {aiMode ? (
          <CommandPaletteAiMode
            entries={entries}
            value={aiValue}
            claudeCodeReady={claudeCodeReady}
            aiAgentReady={resolvedAiAgentReady}
            aiAgentLabel={aiAgentLabel}
            inputRef={aiInputRef}
            onChange={handleAiValueChange}
            onSubmit={handleSubmitAiPrompt}
          />
        ) : (
          <>
            <CommandPaletteInput
              inputRef={inputRef}
              query={query}
              placeholder={t('command.palettePlaceholder')}
              onChange={handleQueryChange}
            />
            <CommandPaletteResults
              groups={groups}
              selectedIndex={selectedIndex}
              listRef={listRef}
              emptyText={t('command.noMatches')}
              locale={locale}
              onHover={setSelectedIndex}
              onSelect={handleSelectCommand}
            />
            <CommandPaletteFooter aiMode={false} aiAgentLabel={aiAgentLabel} footerText={footerText} />
          </>
        )}
      </div>
    </div>
  )
}

interface CommandRowProps {
  command: CommandAction
  selected: boolean
  onHover: () => void
  onSelect: () => void
}

function CommandRow({ command, selected, onHover, onSelect }: CommandRowProps) {
  return (
    <div
      data-selected={selected}
      className={cn(
        'mx-1 flex cursor-pointer items-center justify-between rounded-md px-3 py-1.5 transition-colors',
        selected ? 'bg-accent' : 'hover:bg-secondary',
      )}
      onClick={onSelect}
      onMouseEnter={onHover}
    >
      <span className="text-sm text-foreground">{command.label}</span>
      {command.shortcut && (
        <span className="text-[11px] text-muted-foreground">{command.shortcut}</span>
      )}
    </div>
  )
}
