import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { ICON_OPTIONS, type IconEntry } from '../utils/iconRegistry'
import { ACCENT_COLORS } from '../utils/typeColors'
import { cn } from '@/lib/utils'
import type { FolderNode } from '../types'
import { FolderPicker } from './FolderPicker'

function filterIcons(icons: IconEntry[], query: string): IconEntry[] {
  if (!query) return icons
  const lower = query.toLowerCase()
  return icons.filter((o) => o.name.includes(lower))
}

interface TypeCustomizePopoverProps {
  currentIcon: string | null
  currentColor: string | null
  currentTemplate: string | null
  currentDefaultFolder?: string | null
  folders?: FolderNode[]
  onChangeIcon: (icon: string) => void
  onChangeColor: (color: string) => void
  onChangeTemplate: (template: string) => void
  onChangeDefaultFolder?: (folder: string | null) => void
  onClose: () => void
}

/** Debounce a callback by `delay` ms. Returns a stable ref-based wrapper. */
function useDebouncedCallback(fn: (v: string) => void, delay: number): (v: string) => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const fnRef = useRef(fn)
  useEffect(() => { fnRef.current = fn })

  useEffect(() => () => { clearTimeout(timerRef.current) }, [])

  return useCallback((v: string) => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => fnRef.current(v), delay)
  }, [delay])
}

export function TypeCustomizePopover({
  currentIcon,
  currentColor,
  currentTemplate,
  currentDefaultFolder = null,
  folders = [],
  onChangeIcon,
  onChangeColor,
  onChangeTemplate,
  onChangeDefaultFolder,
  onClose,
}: TypeCustomizePopoverProps) {
  const [selectedColor, setSelectedColor] = useState(currentColor)
  const [selectedIcon, setSelectedIcon] = useState(currentIcon)
  const [search, setSearch] = useState('')
  const [templateText, setTemplateText] = useState(currentTemplate ?? '')

  const filteredIcons = useMemo(() => filterIcons(ICON_OPTIONS, search), [search])

  const handleColorClick = (key: string) => {
    setSelectedColor(key)
    onChangeColor(key)
  }

  const handleIconClick = (name: string) => {
    setSelectedIcon(name)
    onChangeIcon(name)
  }

  const debouncedSaveTemplate = useDebouncedCallback(onChangeTemplate, 500)

  const handleTemplateChange = (value: string) => {
    setTemplateText(value)
    debouncedSaveTemplate(value)
  }

  return (
    <div
      className="bg-popover text-popover-foreground z-50 rounded-lg border shadow-md"
      style={{ width: 320, padding: 12 }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {/* Color section */}
      <div className="font-mono-overline mb-2 text-muted-foreground">Color</div>
      <div className="flex gap-2 mb-3 flex-wrap">
        {ACCENT_COLORS.map((c) => (
          <button
            key={c.key}
            className={cn(
              "flex items-center justify-center rounded-full border-2 cursor-pointer transition-all",
              selectedColor === c.key ? "border-foreground scale-110" : "border-transparent hover:scale-105",
            )}
            style={{ width: 24, height: 24, backgroundColor: c.css, border: selectedColor === c.key ? '2px solid var(--foreground)' : '2px solid transparent' }}
            onClick={() => handleColorClick(c.key)}
            title={c.label}
          />
        ))}
      </div>

      {/* Icon section */}
      <div className="font-mono-overline mb-2 text-muted-foreground">Icon</div>

      {/* Search input */}
      <div className="relative mb-2">
        <MagnifyingGlass
          size={14}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search icons…"
          className="w-full rounded border border-border bg-background pl-7 pr-2 py-1 text-[12px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
        />
      </div>

      {/* Icon grid */}
      <div className="flex flex-wrap gap-1 overflow-y-auto" style={{ maxHeight: 160 }}>
        {filteredIcons.length === 0 ? (
          <div className="w-full py-6 text-center text-[12px] text-muted-foreground">
            No icons found
          </div>
        ) : (
          filteredIcons.map(({ name, Icon }) => (
            <button
              key={name}
              className={cn(
                "flex items-center justify-center rounded cursor-pointer transition-colors",
                selectedIcon === name
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              style={{ width: 30, height: 30 }}
              onClick={() => handleIconClick(name)}
              title={name}
            >
              <Icon size={16} />
            </button>
          ))
        )}
      </div>

      {/* Default folder section */}
      {onChangeDefaultFolder && (
        <>
          <div className="font-mono-overline mb-2 mt-3 text-muted-foreground">Default folder for new notes</div>
          <FolderPicker
            value={currentDefaultFolder}
            onChange={onChangeDefaultFolder}
            folders={folders}
            placeholder="Vault root (default)"
            ariaLabel="Default folder for new notes"
          />
        </>
      )}

      {/* Template section */}
      <div className="font-mono-overline mb-2 mt-3 text-muted-foreground">Template</div>
      <textarea
        value={templateText}
        onChange={(e) => handleTemplateChange(e.target.value)}
        placeholder="Markdown template for new notes of this type…"
        className="w-full rounded border border-border bg-background px-2 py-1.5 text-[12px] font-mono text-foreground placeholder:text-muted-foreground outline-none focus:border-primary resize-y"
        style={{ minHeight: 80, maxHeight: 200 }}
        data-testid="template-textarea"
      />

      {/* Done button */}
      <div className="mt-3 flex justify-end">
        <button
          className="rounded px-3 py-1 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer transition-colors border-none bg-transparent"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  )
}
