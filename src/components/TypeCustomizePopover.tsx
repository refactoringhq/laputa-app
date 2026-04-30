import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { ICON_OPTIONS, type IconEntry } from '../utils/iconRegistry'
import { ACCENT_COLORS } from '../utils/typeColors'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { translate, type AppLocale } from '../lib/i18n'

function filterIcons(icons: IconEntry[], query: string): IconEntry[] {
  if (!query) return icons
  const lower = query.toLowerCase()
  return icons.filter((o) => o.name.includes(lower))
}

interface TypeCustomizePopoverProps {
  currentIcon: string | null
  currentColor: string | null
  currentTemplate: string | null
  onChangeIcon: (icon: string) => void
  onChangeColor: (color: string) => void
  onChangeTemplate: (template: string) => void
  onClose: () => void
  showTemplate?: boolean
  showDone?: boolean
  surface?: 'popover' | 'inline'
  locale?: AppLocale
}

interface ColorSectionProps {
  selectedColor: string | null
  locale: AppLocale
  onSelectColor: (key: string) => void
}

interface IconSectionProps {
  selectedIcon: string | null
  search: string
  filteredIcons: IconEntry[]
  locale: AppLocale
  onSearchChange: (query: string) => void
  onSelectIcon: (name: string) => void
}

interface TemplateSectionProps {
  templateText: string
  locale: AppLocale
  onTemplateChange: (value: string) => void
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

function ColorSection({ selectedColor, locale, onSelectColor }: ColorSectionProps) {
  return (
    <>
      <div className="font-mono-overline mb-2 text-muted-foreground">{translate(locale, 'customize.color')}</div>
      <div className="flex gap-2 mb-3 flex-wrap">
        {ACCENT_COLORS.map((color) => (
          <Button
            key={color.key}
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn(
              'h-6 w-6 rounded-full p-0 transition-transform',
              selectedColor === color.key ? 'scale-110' : 'hover:scale-105',
            )}
            style={{
              width: 24,
              height: 24,
              backgroundColor: color.css,
              border: selectedColor === color.key ? '2px solid var(--foreground)' : '2px solid transparent',
            }}
            onClick={() => onSelectColor(color.key)}
            title={color.label}
            aria-label={color.label}
          />
        ))}
      </div>
    </>
  )
}

function IconSection({
  selectedIcon,
  search,
  filteredIcons,
  locale,
  onSearchChange,
  onSelectIcon,
}: IconSectionProps) {
  return (
    <>
      <div className="font-mono-overline mb-2 text-muted-foreground">{translate(locale, 'customize.icon')}</div>
      <div className="relative mb-2">
        <MagnifyingGlass
          size={14}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
        <Input
          type="text"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={translate(locale, 'customize.searchIcons')}
          className="h-7 pl-7 pr-2 py-1 text-[12px]"
        />
      </div>
      <div className="flex flex-wrap gap-1 overflow-y-auto" style={{ maxHeight: 160 }}>
        {filteredIcons.length === 0 ? (
          <div className="w-full py-6 text-center text-[12px] text-muted-foreground">
            {translate(locale, 'customize.noIconsFound')}
          </div>
        ) : (
          filteredIcons.map(({ name, Icon }) => (
            <Button
              key={name}
              type="button"
              variant="ghost"
              size="icon-xs"
              className={cn(
                'h-[30px] w-[30px] rounded p-0 transition-colors',
                selectedIcon === name
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
              onClick={() => onSelectIcon(name)}
              title={name}
              aria-label={name}
            >
              <Icon size={16} />
            </Button>
          ))
        )}
      </div>
    </>
  )
}

function TemplateSection({ templateText, locale, onTemplateChange }: TemplateSectionProps) {
  return (
    <>
      <div className="font-mono-overline mb-2 mt-3 text-muted-foreground">{translate(locale, 'customize.template')}</div>
      <Textarea
        value={templateText}
        onChange={(event) => onTemplateChange(event.target.value)}
        placeholder={translate(locale, 'customize.templatePlaceholder')}
        className="min-h-20 max-h-[200px] resize-y px-2 py-1.5 text-[12px] font-mono"
        data-testid="template-textarea"
      />
    </>
  )
}

function DoneSection({ locale, onClose }: { locale: AppLocale; onClose: () => void }) {
  return (
    <div className="mt-3 flex justify-end">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="text-muted-foreground hover:text-foreground"
        onClick={onClose}
      >
        {translate(locale, 'customize.done')}
      </Button>
    </div>
  )
}

export function TypeCustomizePopover({
  currentIcon,
  currentColor,
  currentTemplate,
  onChangeIcon,
  onChangeColor,
  onChangeTemplate,
  onClose,
  showTemplate = true,
  showDone = true,
  surface = 'popover',
  locale = 'en',
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
      className={cn(
        'text-popover-foreground z-50',
        surface === 'popover' && 'rounded-lg border bg-popover shadow-md',
      )}
      style={surface === 'popover' ? { width: 320, padding: 12 } : undefined}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <ColorSection selectedColor={selectedColor} locale={locale} onSelectColor={handleColorClick} />
      <IconSection
        selectedIcon={selectedIcon}
        search={search}
        filteredIcons={filteredIcons}
        locale={locale}
        onSearchChange={setSearch}
        onSelectIcon={handleIconClick}
      />
      {showTemplate && (
        <TemplateSection templateText={templateText} locale={locale} onTemplateChange={handleTemplateChange} />
      )}
      {showDone && <DoneSection locale={locale} onClose={onClose} />}
    </div>
  )
}
